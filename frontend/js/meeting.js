requireAuth();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const code = (location.pathname.startsWith('/m/') ? location.pathname.slice(3) : new URLSearchParams(location.search).get('code') || '')
  .toLowerCase().replace(/[^a-z-]/g, '');
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

let me = null;                 // my profile
let meInfo = null;             // my room info (from server)
let socket = null;
let camTrack = null, micTrack = null, screenTrack = null;
let state = { mic: true, cam: true, sharing: false };
const peers = new Map();       // socketId -> { info, pc, stream, pending, tile }
const chatLog = [];
let unreadChat = 0, panelTab = null;

/* ================= lobby ================= */
(async function lobby() {
  if (!code) { location.href = '/'; return; }
  try {
    me = await api('/me');
    const m = await api('/meetings/' + code);
    $('#lTitle').textContent = m.title;
  } catch (e) {
    if (e.message !== 'auth') { $('#lErr').textContent = e.message; $('#lErr').hidden = false; }
    return;
  }
  $('#lCode').textContent = 'Meeting code: ' + code;
  await initMedia();
  refreshLobbyButtons();
  $('#joinNow').disabled = false;
})();

async function initMedia() {
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
  }
  if (stream) { camTrack = stream.getVideoTracks()[0] || null; micTrack = stream.getAudioTracks()[0] || null; }
  state.cam = !!camTrack; state.mic = !!micTrack;
  if (!stream) toast('Camera and microphone are blocked. You can still join and chat.', 'error');
  $('#previewOff').innerHTML = avatar(me, 96);
  if (camTrack) $('#preview').srcObject = new MediaStream([camTrack]);
}

function applyTracks() {
  if (micTrack) micTrack.enabled = state.mic;
  if (camTrack) camTrack.enabled = state.cam;
}
function setBtn(btn, on, iconOn, iconOff, disabled) {
  btn.classList.toggle('off', !on);
  btn.disabled = !!disabled;
  $('.ms', btn).textContent = on ? iconOn : iconOff;
}
function refreshLobbyButtons() {
  setBtn($('#lMic'), state.mic, 'mic', 'mic_off', !micTrack);
  setBtn($('#lCam'), state.cam, 'videocam', 'videocam_off', !camTrack);
  $('#previewOff').hidden = state.cam;
  $('#preview').style.visibility = state.cam ? 'visible' : 'hidden';
}
$('#lMic').onclick = () => { state.mic = !state.mic; applyTracks(); refreshLobbyButtons(); };
$('#lCam').onclick = () => { state.cam = !state.cam; applyTracks(); refreshLobbyButtons(); };

/* ================= join ================= */
$('#joinNow').onclick = () => {
  applyTracks();
  $('#joinNow').disabled = true;
  socket = io({ auth: { token: store.token } });
  bindSocket();
  socket.emit('meet:join', { code }, res => {
    if (res.error) { $('#lErr').textContent = res.error; $('#lErr').hidden = false; $('#joinNow').disabled = false; return; }
    meInfo = res.me;
    $('#lobby').hidden = true;
    $('#room').hidden = false;
    $('#codeText').textContent = code;
    startTimer();
    addTile(meInfo, true);
    res.peers.forEach(p => { addPeer(p); startConnection(p.id); });
    res.chat.forEach(m => { chatLog.push(m); });
    renderChat(); renderFiles();
    res.seg.forEach(g => segs.push(g));
    initBoard();
    updateRoomButtons();
    socket.emit('meet:media', state);
    layout();
  });
};

/* ================= video tiles ================= */
function addTile(info, isMe) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (isMe ? ' me' : '');
  tile.id = 'tile-' + info.id;
  tile.innerHTML = `<video autoplay playsinline ${isMe ? 'muted' : ''}></video>
    <div class="tile-av">${avatar(info, 84)}</div>
    <div class="tile-name"><span class="ms mic-off" hidden>mic_off</span><span>${esc(isMe ? 'You' : info.name)}</span></div>
    <span class="tile-tag" hidden>Presenting</span>`;
  $('#grid').appendChild(tile);
  if (isMe) setLocalVideo();
  paintTile(info);
  return tile;
}
function paintTile(info) {
  const t = $('#tile-' + info.id);
  if (!t) return;
  const showVideo = info.sharing || info.cam;
  t.classList.toggle('cam-off', !showVideo);
  t.classList.toggle('sharing', !!info.sharing);
  $('.mic-off', t).hidden = !!info.mic;
  $('.tile-tag', t).hidden = !info.sharing;
  if (t.classList.contains('me')) t.classList.toggle('mirror', !info.sharing);
}
function setLocalVideo() {
  const v = $('#tile-' + meInfo.id + ' video');
  const track = state.sharing ? screenTrack : camTrack;
  v.srcObject = track ? new MediaStream([track]) : null;
}
function layout() {
  const n = $('#grid').children.length;
  $('#grid').style.setProperty('--cols', n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4);
  $('#grid').dataset.n = n;
  $('#pCount').textContent = n;
  renderPeople();
}

/* ================= peers + WebRTC ================= */
function addPeer(info) {
  const P = { info, pc: null, stream: new MediaStream(), pending: [] };
  peers.set(info.id, P);
  const tile = addTile(info, false);
  P.tile = tile;
  $('video', tile).srcObject = P.stream;
  layout();
  return P;
}
const videoTrack = () => state.sharing ? screenTrack : camTrack;

function makePC(id) {
  const P = peers.get(id);
  const pc = new RTCPeerConnection(ICE);
  P.pc = pc;
  pc.onicecandidate = e => { if (e.candidate) socket.emit('signal', { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => { P.stream.addTrack(e.track); $('video', P.tile).srcObject = P.stream; };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') toast(`Connection to ${P.info.name} failed. Ask them to rejoin.`, 'error');
  };
  return pc;
}
async function startConnection(id) {          // we are the newcomer -> we send the offer
  const pc = makePC(id);
  const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const v = pc.addTransceiver('video', { direction: 'sendrecv' });
  if (micTrack) a.sender.replaceTrack(micTrack);
  if (videoTrack()) v.sender.replaceTrack(videoTrack());
  await pc.setLocalDescription(await pc.createOffer());
  socket.emit('signal', { to: id, data: { sdp: pc.localDescription } });
}
async function onSignal({ from, data }) {
  const P = peers.get(from);
  if (!P) return;
  if (data.sdp) {
    const pc = P.pc || makePC(from);
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') {
      pc.getTransceivers().forEach(t => {
        t.direction = 'sendrecv';
        const track = t.receiver.track.kind === 'audio' ? micTrack : videoTrack();
        if (track) t.sender.replaceTrack(track);
      });
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
    }
    for (const c of P.pending.splice(0)) { try { await pc.addIceCandidate(c); } catch {} }
  } else if (data.candidate) {
    if (P.pc && P.pc.remoteDescription) { try { await P.pc.addIceCandidate(data.candidate); } catch {} }
    else P.pending.push(data.candidate);
  }
}
function replaceVideoEverywhere(track) {
  peers.forEach(P => P.pc && P.pc.getTransceivers().forEach(t => {
    if (t.receiver.track.kind === 'video') t.sender.replaceTrack(track || null);
  }));
}

/* ================= socket events ================= */
function bindSocket() {
  socket.on('signal', onSignal);
  socket.on('meet:peer-joined', info => { addPeer(info); toast(`${info.name} joined`); });
  socket.on('meet:peer-left', ({ id }) => {
    const P = peers.get(id);
    if (!P) return;
    toast(`${P.info.name} left`);
    if (P.pc) P.pc.close();
    P.tile.remove();
    peers.delete(id);
    layout();
  });
  socket.on('meet:media', st => {
    const P = peers.get(st.id);
    if (!P) return;
    Object.assign(P.info, st);
    paintTile(P.info);
    renderPeople();
  });
  socket.on('meet:chat', m => {
    chatLog.push(m);
    renderChat(); renderFiles();
    if (panelTab !== 'chat' && m.from !== socket.id) { unreadChat++; $('#chatDot').hidden = false; }
  });
  socket.on('wb:seg', g => {
    segs.push(g); drawSeg(g);
    if ($('#wbWrap').hidden) $('#boardDot').hidden = false;
  });
  socket.on('wb:clear', () => { segs.length = 0; redraw(); });
  socket.on('connect_error', () => toast('Connection lost. Check your internet.', 'error'));
}

/* ================= controls ================= */
function updateRoomButtons() {
  setBtn($('#bMic'), state.mic, 'mic', 'mic_off', !micTrack);
  setBtn($('#bCam'), state.cam, 'videocam', 'videocam_off', !camTrack);
  $('#bShare').classList.toggle('active', state.sharing);
  $('.ms', $('#bShare')).textContent = state.sharing ? 'stop_screen_share' : 'present_to_all';
  $('#bBoard').classList.toggle('active', !$('#wbWrap').hidden);
  Object.assign(meInfo, state);
  paintTile(meInfo);
  renderPeople();
}
function broadcastState() { applyTracks(); updateRoomButtons(); socket.emit('meet:media', state); }
$('#bMic').onclick = () => { state.mic = !state.mic; broadcastState(); };
$('#bCam').onclick = () => { state.cam = !state.cam; broadcastState(); };

if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) $('#bShare').style.display = 'none';
$('#bShare').onclick = async () => {
  if (state.sharing) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    screenTrack = s.getVideoTracks()[0];
    screenTrack.onended = stopShare;
    state.sharing = true;
    replaceVideoEverywhere(screenTrack);
    setLocalVideo(); broadcastState();
  } catch { /* user cancelled */ }
};
function stopShare() {
  if (!state.sharing) return;
  if (screenTrack) { screenTrack.onended = null; screenTrack.stop(); screenTrack = null; }
  state.sharing = false;
  replaceVideoEverywhere(camTrack);
  setLocalVideo(); broadcastState();
}

$('#copyLink').onclick = () => copyText(meetLink(code));
$('#bLeave').onclick = leave;
function leave() {
  if (socket) { socket.emit('meet:leave'); socket.disconnect(); }
  [camTrack, micTrack, screenTrack].forEach(t => t && t.stop());
  peers.forEach(P => P.pc && P.pc.close());
  location.href = '/';
}
window.addEventListener('beforeunload', () => { if (socket) socket.disconnect(); });

let t0 = 0;
function startTimer() {
  t0 = Date.now();
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

/* ================= side panel: chat / people / files ================= */
function openPanel(tab) {
  if (panelTab === tab) { panelTab = null; $('#panel').hidden = true; }
  else {
    panelTab = tab;
    $('#panel').hidden = false;
    $$('.ptab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#tabChat').hidden = tab !== 'chat';
    $('#tabPeople').hidden = tab !== 'people';
    $('#tabFiles').hidden = tab !== 'files';
    if (tab === 'chat') { unreadChat = 0; $('#chatDot').hidden = true; const m = $('#cmsgs'); m.scrollTop = m.scrollHeight; $('#cInput').focus(); }
  }
  $('#bChat').classList.toggle('active', panelTab === 'chat');
  $('#bPeople').classList.toggle('active', panelTab === 'people');
  $('#bFiles').classList.toggle('active', panelTab === 'files');
  requestAnimationFrame(sizeBoard);
}
$('#bChat').onclick = () => openPanel('chat');
$('#bPeople').onclick = () => openPanel('people');
$('#bFiles').onclick = () => openPanel('files');
$('#panelClose').onclick = () => openPanel(panelTab);
$$('.ptab').forEach(b => b.onclick = () => { const t = b.dataset.tab; if (panelTab !== t) { panelTab = null; openPanel(t); } });

function renderChat() {
  const box = $('#cmsgs');
  if (!box) return;
  box.innerHTML = chatLog.length ? chatLog.map(m => `
    <div class="cm ${m.from === socket.id ? 'mine' : ''}">
      <div class="cm-head"><b>${m.from === socket.id ? 'You' : esc(m.name)}</b><small>${fmtTime(m.time)}</small></div>
      ${fileHTML(m.file)}${m.text ? `<p>${linkify(esc(m.text))}</p>` : ''}
    </div>`).join('') : '<div class="empty small"><p>Messages are visible to everyone in this call.</p></div>';
  box.scrollTop = box.scrollHeight;
}
function renderFiles() {
  const files = chatLog.filter(m => m.file);
  $('#flist').innerHTML = files.length ? files.map(m => `
    <div class="frow">${fileHTML(m.file)}<small>Shared by ${m.from === socket.id ? 'you' : esc(m.name)} at ${fmtTime(m.time)}</small></div>`).join('')
    : '<div class="empty small"><p>No files shared yet. Share a file and everyone can download it.</p></div>';
}
function renderPeople() {
  if (!meInfo) return;
  const all = [meInfo, ...[...peers.values()].map(p => p.info)];
  $('#plist').innerHTML = all.map(p => `
    <div class="prow">${avatar(p, 38)}<span class="grow"><b>${esc(p.name)}${p.id === meInfo.id ? ' (You)' : ''}</b>${p.sharing ? '<small>Presenting</small>' : ''}</span>
    <span class="ms ${p.mic ? '' : 'muted'}">${p.mic ? 'mic' : 'mic_off'}</span><span class="ms ${p.cam ? '' : 'muted'}">${p.cam ? 'videocam' : 'videocam_off'}</span></div>`).join('');
}
function sendChat(file) {
  const i = $('#cInput');
  const text = i.value.trim();
  if (!text && !file) return;
  socket.emit('meet:chat', { text, file });
  i.value = '';
}
$('#cSend').onclick = () => sendChat();
$('#cInput').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
async function pickFile(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  toast('Uploading ' + f.name + '\u2026');
  try { sendChat(await uploadFile(f)); toast('File shared'); } catch (err) { toast(err.message, 'error'); }
}
$('#cFile').onchange = pickFile;
$('#cAttach').onclick = () => $('#cFile').click();
$('#cShare').onclick = () => $('#cFile').click();

/* ================= whiteboard ================= */
const cv = $('#wbCanvas'), ctx = cv.getContext('2d');
const segs = [];
const tool = { color: '#202124', size: 4, erase: false };
const COLORS = ['#202124', '#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#a142f4'];
let drawing = false, last = null, boardReady = false;

function initBoard() {
  if (boardReady) return;
  boardReady = true;
  $('#wbColors').innerHTML = COLORS.map((c, i) => `<button class="cdot ${i === 0 ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  $('#wbColors').onclick = e => {
    const c = e.target.dataset.c; if (!c) return;
    tool.color = c; tool.erase = false;
    $$('.cdot').forEach(d => d.classList.toggle('on', d.dataset.c === c));
    $('#toolPen').classList.add('on'); $('#toolEraser').classList.remove('on');
  };
  $('#toolPen').onclick = () => { tool.erase = false; $('#toolPen').classList.add('on'); $('#toolEraser').classList.remove('on'); };
  $('#toolEraser').onclick = () => { tool.erase = true; $('#toolEraser').classList.add('on'); $('#toolPen').classList.remove('on'); };
  $('#wbSize').oninput = e => tool.size = +e.target.value;
  $('#wbClear').onclick = () => { if (confirm('Clear the whiteboard for everyone?')) { segs.length = 0; redraw(); socket.emit('wb:clear'); } };
  $('#wbSave').onclick = () => { const a = document.createElement('a'); a.download = 'whiteboard.png'; a.href = cv.toDataURL('image/png'); a.click(); };
  new ResizeObserver(sizeBoard).observe($('#wbBox'));

  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', e => { drawing = true; cv.setPointerCapture(e.pointerId); last = pos(e); stroke(last, last); });
  cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); stroke(last, p); last = p; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => cv.addEventListener(ev, () => { drawing = false; }));
}
function stroke(a, b) {
  const g = { c: tool.erase ? '#ffffff' : tool.color, w: tool.erase ? tool.size * 4 : tool.size, a, b };
  segs.push(g); drawSeg(g); socket.emit('wb:seg', g);
}
function drawSeg(g) {
  ctx.strokeStyle = g.c; ctx.lineWidth = g.w * cv.width / 1000;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(g.a[0] * cv.width, g.a[1] * cv.height);
  ctx.lineTo(g.b[0] * cv.width + 0.01, g.b[1] * cv.height);
  ctx.stroke();
}
function redraw() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  segs.forEach(drawSeg);
}
function sizeBoard() {
  const box = $('#wbBox');
  if (!box || $('#wbWrap').hidden) return;
  const r = box.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * d));
  cv.height = Math.max(1, Math.round(r.height * d));
  redraw();
}
$('#bBoard').onclick = () => {
  const open = $('#wbWrap').hidden;
  $('#wbWrap').hidden = !open;
  $('#main').classList.toggle('wb-on', open);
  if (open) $('#boardDot').hidden = true;
  updateRoomButtons();
  requestAnimationFrame(sizeBoard);
};