requireAuth();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let me = null, meetings = [], hist = [], chats = [];
let active = null, activeMsgs = [], typingTimer = null;
const online = new Set();
const notified = new Set();
const socket = io({ auth: { token: store.token } });

/* ================= boot ================= */
(async function init() {
  me = await api('/me');
  $('#avBtn').innerHTML = avatar(me, 36);
  tickClock(); setInterval(tickClock, 30000);
  await Promise.all([loadMeetings(), loadChats()]);
  route();
  setInterval(checkReminders, 30000);
  checkReminders();
})();

function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ' \u2022 ' + d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ================= routing ================= */
function route() {
  const v = location.hash.slice(1) || 'meetings';
  const view = $('#view-' + v) ? v : 'meetings';
  $$('.view').forEach(s => s.hidden = s.id !== 'view-' + view);
  $$('#side a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#side').classList.remove('open');
  if (view === 'meetings') renderUpcoming();
  if (view === 'calendar') renderCalendar();
  if (view === 'history') loadHistory();
  if (view === 'chats') renderChatList();
  if (view === 'profile') renderProfile();
}
window.addEventListener('hashchange', route);
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');

/* ================= dropdowns ================= */
function closeMenus() { $$('.dropdown').forEach(d => d.hidden = true); }
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
$('#newBtn').onclick = () => { const h = $('#newMenu').hidden; closeMenus(); $('#newMenu').hidden = !h; };
$('#avBtn').onclick = () => { const h = $('#userMenu').hidden; closeMenus(); $('#userMenu').hidden = !h; };
$('#newMenu').onclick = e => {
  const act = e.target.closest('button')?.dataset.act;
  closeMenus();
  if (act === 'instant') startInstant();
  if (act === 'later') createLater();
  if (act === 'schedule') openSchedule();
};
$('#userMenu').onclick = e => { const g = e.target.closest('button')?.dataset.go; if (g) { location.hash = g; closeMenus(); } };
$('#logoutBtn').onclick = () => { store.token = null; location.href = '/login.html'; };

/* ================= modal ================= */
function openModal(html, mount) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  $('#modalRoot').appendChild(back);
  mount && mount(back.firstElementChild);
  return back;
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ================= join / new meeting ================= */
const CODE_RE = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
$('#joinInput').oninput = e => { $('#joinBtn').disabled = !CODE_RE.test(e.target.value); };
$('#joinInput').onkeydown = e => { if (e.key === 'Enter') joinByInput(); };
$('#joinBtn').onclick = joinByInput;
async function joinByInput() {
  const m = $('#joinInput').value.match(CODE_RE);
  if (!m) return toast('Enter a valid meeting code like abc-defg-hij', 'error');
  joinCode(m[1].toLowerCase());
}
async function joinCode(code) {
  try { await api('/meetings/' + code); location.href = '/m/' + code; }
  catch (e) { toast(e.message, 'error'); }
}
async function startInstant() {
  try { const m = await api('/meetings', { method: 'POST', body: { title: 'Instant meeting' } }); location.href = '/m/' + m.code; }
  catch (e) { toast(e.message, 'error'); }
}
async function createLater() {
  try { const m = await api('/meetings', { method: 'POST', body: { title: 'Meeting link' } }); showLink(m, 'Here\u2019s your meeting link'); }
  catch (e) { toast(e.message, 'error'); }
}
function showLink(m, heading) {
  const link = meetLink(m.code);
  openModal(`
    <h3>${esc(heading)}</h3>
    <p class="hint">Share this link with anyone who has a Meetly account. Keep it safe: anyone with the link can join.</p>
    <div class="link-box"><span>${esc(link)}</span><button class="icon-btn" id="mCopy" aria-label="Copy link"><span class="ms">content_copy</span></button></div>
    <div class="modal-actions"><button class="btn ghost" id="mClose">Close</button><button class="btn primary" id="mJoin"><span class="ms">videocam</span>Join now</button></div>`,
  el => {
    $('#mCopy', el).onclick = () => copyText(link);
    $('#mClose', el).onclick = closeModal;
    $('#mJoin', el).onclick = () => joinCode(m.code);
  });
}
$('#heroNew').onclick = startInstant;
$('#heroSchedule').onclick = () => openSchedule();

/* ================= meetings + calendar ================= */
async function loadMeetings() { try { meetings = await api('/meetings'); } catch {} }
const dKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const whenText = iso => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function renderUpcoming() {
  const now = Date.now();
  const up = meetings.filter(m => new Date(m.start).getTime() > now - 3600e3);
  $('#upcoming').innerHTML = up.length ? up.map(m => `
    <div class="row-card" data-id="${m.id}">
      <span class="row-icon"><span class="ms">event</span></span>
      <div class="grow"><b>${esc(m.title)}</b><small>${whenText(m.start)} \u2022 ${m.code}</small></div>
      <button class="icon-btn" data-a="copy" title="Copy link"><span class="ms">content_copy</span></button>
      <button class="btn primary small" data-a="join">Join</button>
    </div>`).join('') : `<div class="empty"><span class="ms">event_available</span><p>No upcoming meetings. Plan one in the calendar and share the link.</p><button class="btn outline" id="emptySchedule">Schedule a meeting</button></div>`;
  const b = $('#emptySchedule'); if (b) b.onclick = () => openSchedule();
}
$('#upcoming').onclick = e => {
  const row = e.target.closest('.row-card'); if (!row) return;
  const m = meetings.find(x => x.id === row.dataset.id);
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'copy') copyText(meetLink(m.code));
  else if (a === 'join') joinCode(m.code);
  else showMeeting(m);
};

let cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
function renderCalendar() {
  $('#calTitle').textContent = new Date(cal.y, cal.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const byDay = {};
  meetings.forEach(m => (byDay[dKey(new Date(m.start))] ||= []).push(m));
  const startOffset = new Date(cal.y, cal.m, 1).getDay();
  const todayKey = dKey(new Date());
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(cal.y, cal.m, 1 - startOffset + i);
    const k = dKey(d);
    const evs = (byDay[k] || []).sort((a, b) => a.start.localeCompare(b.start));
    html += `<div class="cal-cell ${d.getMonth() !== cal.m ? 'other' : ''} ${k === todayKey ? 'today' : ''}" data-date="${k}">
      <span class="cal-num">${d.getDate()}</span>
      ${evs.slice(0, 2).map(m => `<button class="chip" data-id="${m.id}">${fmtTime(m.start)} ${esc(m.title)}</button>`).join('')}
      ${evs.length > 2 ? `<small class="more">+${evs.length - 2} more</small>` : ''}
    </div>`;
  }
  $('#calGrid').innerHTML = html;
}
$('#calPrev').onclick = () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCalendar(); };
$('#calNext').onclick = () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCalendar(); };
$('#calToday').onclick = () => { cal = { y: new Date().getFullYear(), m: new Date().getMonth() }; renderCalendar(); };
$('#calAdd').onclick = () => openSchedule();
$('#calGrid').onclick = e => {
  const chip = e.target.closest('.chip');
  if (chip) return showMeeting(meetings.find(m => m.id === chip.dataset.id));
  const cell = e.target.closest('.cal-cell');
  if (cell) openSchedule(cell.dataset.date);
};

function openSchedule(date) {
  const now = new Date(Date.now() + 3600e3);
  const d = date || dKey(now);
  const t = `${String(now.getHours()).padStart(2, '0')}:00`;
  openModal(`
    <h3>Schedule a meeting</h3>
    <form class="stack" id="schedForm">
      <label class="field"><span>Title</span><input id="sTitle" placeholder="Team sync" maxlength="80" required></label>
      <div class="two">
        <label class="field"><span>Date</span><input type="date" id="sDate" value="${d}" required></label>
        <label class="field"><span>Time</span><input type="time" id="sTime" value="${t}" required></label>
      </div>
      <p class="err" id="sErr" hidden></p>
      <div class="modal-actions"><button type="button" class="btn ghost" id="sCancel">Cancel</button><button class="btn primary" type="submit">Save and get link</button></div>
    </form>`,
  el => {
    $('#sTitle', el).focus();
    $('#sCancel', el).onclick = closeModal;
    $('#schedForm', el).onsubmit = async ev => {
      ev.preventDefault();
      try {
        const start = new Date(`${$('#sDate', el).value}T${$('#sTime', el).value}`);
        const m = await api('/meetings', { method: 'POST', body: { title: $('#sTitle', el).value, start: start.toISOString() } });
        await loadMeetings(); route();
        showLink(m, 'Meeting scheduled');
      } catch (err) { const p = $('#sErr', el); p.textContent = err.message; p.hidden = false; }
    };
  });
}

function showMeeting(m) {
  if (!m) return;
  const link = meetLink(m.code);
  const s = new Date(m.start), e = new Date(s.getTime() + 3600e3);
  const g = x => x.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(m.title)}&dates=${g(s)}/${g(e)}&details=${encodeURIComponent('Join: ' + link)}`;
  openModal(`
    <h3>${esc(m.title)}</h3>
    <p class="hint">${whenText(m.start)}</p>
    <div class="link-box"><span>${esc(link)}</span><button class="icon-btn" id="dCopy" aria-label="Copy link"><span class="ms">content_copy</span></button></div>
    <a class="btn ghost small" href="${gcal}" target="_blank" rel="noopener"><span class="ms">add</span>Add to Google Calendar</a>
    <div class="modal-actions"><button class="btn ghost danger-text" id="dDel"><span class="ms">delete</span>Delete</button><button class="btn primary" id="dJoin"><span class="ms">videocam</span>Join</button></div>`,
  el => {
    $('#dCopy', el).onclick = () => copyText(link);
    $('#dJoin', el).onclick = () => joinCode(m.code);
    $('#dDel', el).onclick = async () => {
      try { await api('/meetings/' + m.id, { method: 'DELETE' }); await loadMeetings(); closeModal(); route(); toast('Meeting deleted'); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

function checkReminders() {
  const now = Date.now();
  meetings.forEach(m => {
    const diff = new Date(m.start).getTime() - now;
    if (diff < 5 * 60e3 && diff > -10 * 60e3 && !notified.has(m.id)) {
      notified.add(m.id);
      toast(`"${m.title}" ${diff > 0 ? 'starts soon' : 'has started'}`, '', { label: 'Join', fn: () => joinCode(m.code) });
    }
  });
}

/* ================= history ================= */
async function loadHistory() {
  try { hist = await api('/history'); } catch { hist = []; }
  $('#clearHist').hidden = !hist.length;
  $('#histList').innerHTML = hist.length ? hist.map(h => `
    <div class="row-card" data-id="${h.id}">
      <span class="row-icon"><span class="ms">videocam</span></span>
      <div class="grow">
        <b>${esc(h.title)}</b>
        <small>${fmtDate(h.joinedAt)}, ${fmtTime(h.joinedAt)} \u2022 ${h.leftAt ? fmtDur(h.leftAt - h.joinedAt) : 'In progress'} \u2022 ${h.code}</small>
        ${h.participants && h.participants.length ? `<div class="chips">${h.participants.slice(0, 6).map(n => `<span class="tag">${esc(n)}</span>`).join('')}</div>` : ''}
      </div>
      <button class="btn outline small" data-a="again">Join again</button>
      <button class="icon-btn" data-a="del" title="Delete from history"><span class="ms">delete</span></button>
    </div>`).join('') : `<div class="empty"><span class="ms">history</span><p>No calls yet. Meetings you join will show up here.</p></div>`;
}
$('#histList').onclick = async e => {
  const row = e.target.closest('.row-card'); if (!row) return;
  const a = e.target.closest('[data-a]')?.dataset.a;
  const h = hist.find(x => x.id === row.dataset.id);
  if (a === 'again') joinCode(h.code);
  if (a === 'del') { await api('/history/' + h.id, { method: 'DELETE' }); toast('Removed from history'); loadHistory(); }
};
$('#clearHist').onclick = () => openModal(`
  <h3>Clear all call history?</h3><p class="hint">This removes every call from your history. It can't be undone.</p>
  <div class="modal-actions"><button class="btn ghost" id="cNo">Cancel</button><button class="btn danger" id="cYes">Clear history</button></div>`,
el => {
  $('#cNo', el).onclick = closeModal;
  $('#cYes', el).onclick = async () => { await api('/history', { method: 'DELETE' }); closeModal(); toast('History cleared'); loadHistory(); };
});

/* ================= chats ================= */
const EMOJIS = ['😀', '😂', '😍', '🥳', '😎', '🤔', '😢', '😡', '👍', '👏', '🙏', '🔥', '🎉', '❤️', '💯', '✅'];
async function loadChats() { try { chats = await api('/chats'); } catch {} updateBadge(); }
function updateBadge() {
  const n = chats.reduce((a, c) => a + c.unread, 0);
  $('#chatBadge').hidden = !n;
  $('#chatBadge').textContent = n > 9 ? '9+' : n;
}
const preview = m => m ? (m.file ? '\uD83D\uDCCE ' + m.file.name : m.text) : '';
const dot = id => online.has(id) ? '<i class="online-dot"></i>' : '';

async function renderChatList() {
  const q = $('#chatSearch').value.trim();
  const box = $('#chatList');
  if (q.length >= 2) {
    let users = [];
    try { users = await api('/users?q=' + encodeURIComponent(q)); } catch {}
    box.innerHTML = users.length ? users.map(u => `
      <button class="chat-item" data-uid="${u.id}"><span class="av-wrap">${avatar(u, 46)}${dot(u.id)}</span>
      <span class="ci-main"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></span></button>`).join('')
      : '<div class="empty small"><p>No one found. They need a verified Meetly account.</p></div>';
    return;
  }
  box.innerHTML = chats.length ? chats.map(c => `
    <button class="chat-item ${active && active.id === c.user.id ? 'on' : ''}" data-uid="${c.user.id}">
      <span class="av-wrap">${avatar(c.user, 46)}${dot(c.user.id)}</span>
      <span class="ci-main"><b>${esc(c.user.name)}</b><small>${c.last.from === me.id ? 'You: ' : ''}${esc(preview(c.last))}</small></span>
      <span class="ci-meta"><small>${fmtTime(c.last.time)}</small>${c.unread ? `<em>${c.unread}</em>` : ''}</span>
    </button>`).join('')
    : '<div class="empty small"><p>No chats yet. Search for a person above to say hello.</p></div>';
}
let searchT;
$('#chatSearch').oninput = () => { clearTimeout(searchT); searchT = setTimeout(renderChatList, 250); };
$('#chatList').onclick = e => { const b = e.target.closest('.chat-item'); if (b) openChat(b.dataset.uid); };

async function openChat(id) {
  try {
    const d = await api('/messages/' + id);
    active = d.user; activeMsgs = d.messages;
  } catch (e) { return toast(e.message, 'error'); }
  $('#chatEmpty').hidden = true; $('#chatBox').hidden = false;
  $('#chatPane').classList.add('show');
  renderChatHead(); renderMsgs();
  const c = chats.find(x => x.user.id === id);
  if (c && c.unread) { c.unread = 0; updateBadge(); socket.emit('dm:read', { from: id }); }
  renderChatList();
  $('#msgInput').focus();
}
function renderChatHead(typing) {
  $('#chatWho').innerHTML = `<span class="av-wrap">${avatar(active, 42)}${dot(active.id)}</span>
    <div><b>${esc(active.name)}</b><small class="${typing || online.has(active.id) ? 'live' : ''}">${typing ? 'typing\u2026' : online.has(active.id) ? 'online' : 'offline'}</small></div>`;
}
function msgHTML(m) {
  const mine = m.from === me.id;
  return `<div class="bubble ${mine ? 'mine' : ''}">${fileHTML(m.file)}${m.text ? `<p>${linkify(esc(m.text))}</p>` : ''}
    <span class="meta">${fmtTime(m.time)}${mine ? `<span class="ms tick ${m.read ? 'read' : ''}">${m.read ? 'done_all' : 'done'}</span>` : ''}</span></div>`;
}
function renderMsgs() {
  const box = $('#msgs');
  box.innerHTML = activeMsgs.length ? activeMsgs.map(msgHTML).join('') : '<div class="empty small"><p>No messages yet. Say hi!</p></div>';
  box.scrollTop = box.scrollHeight;
}
$('#chatBack').onclick = () => { $('#chatPane').classList.remove('show'); active = null; renderChatList(); };

function sendMsg(file) {
  const input = $('#msgInput');
  const text = input.value.trim();
  if ((!text && !file) || !active) return;
  socket.emit('dm:send', { to: active.id, text, file });
  input.value = '';
  $('#emojiPop').hidden = true;
}
$('#sendBtn').onclick = () => sendMsg();
$('#msgInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
let lastTyping = 0;
$('#msgInput').oninput = () => { if (active && Date.now() - lastTyping > 1500) { lastTyping = Date.now(); socket.emit('dm:typing', { to: active.id }); } };
$('#attachBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  toast('Uploading ' + f.name + '\u2026');
  try { sendMsg(await uploadFile(f)); } catch (err) { toast(err.message, 'error'); }
};
$('#emojiPop').innerHTML = EMOJIS.map(e => `<button>${e}</button>`).join('');
$('#emojiBtn').onclick = () => { $('#emojiPop').hidden = !$('#emojiPop').hidden; };
$('#emojiPop').onclick = e => { if (e.target.tagName === 'BUTTON') { $('#msgInput').value += e.target.textContent; $('#msgInput').focus(); } };
$('#chatCall').onclick = async () => {
  if (!active) return;
  try {
    const m = await api('/meetings', { method: 'POST', body: { title: 'Call with ' + active.name } });
    socket.emit('dm:send', { to: active.id, text: 'Join my video call: ' + meetLink(m.code) });
    location.href = '/m/' + m.code;
  } catch (e) { toast(e.message, 'error'); }
};

/* realtime */
socket.on('presence:list', ids => { ids.forEach(i => online.add(i)); if (!$('#view-chats').hidden) { renderChatList(); if (active) renderChatHead(); } });
socket.on('presence', ({ userId, online: on }) => {
  on ? online.add(userId) : online.delete(userId);
  if (!$('#view-chats').hidden) { renderChatList(); if (active) renderChatHead(); }
});
socket.on('dm:new', async m => {
  const other = m.from === me.id ? m.to : m.from;
  const viewing = active && active.id === other && !$('#view-chats').hidden;
  if (viewing) {
    activeMsgs.push(m);
    $('#msgs').insertAdjacentHTML('beforeend', msgHTML(m));
    $('#msgs').scrollTop = $('#msgs').scrollHeight;
    if (m.from !== me.id) socket.emit('dm:read', { from: other });
  }
  await loadChats();
  if (viewing) { const c = chats.find(x => x.user.id === other); if (c) c.unread = 0; updateBadge(); }
  else if (m.from !== me.id) {
    const c = chats.find(x => x.user.id === other);
    toast(`New message from ${c ? c.user.name : 'someone'}`, '', { label: 'Open', fn: () => { location.hash = 'chats'; setTimeout(() => openChat(other), 50); } });
  }
  if (!$('#view-chats').hidden) renderChatList();
});
socket.on('dm:typing', ({ from }) => {
  if (!active || active.id !== from) return;
  renderChatHead(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => renderChatHead(), 2000);
});
socket.on('dm:read', ({ by }) => {
  if (active && active.id === by) { activeMsgs.forEach(m => { if (m.from === me.id) m.read = true; }); renderMsgs(); }
});

/* ================= profile ================= */
const PALETTE = ['#1a73e8', '#e8710a', '#188038', '#a142f4', '#d93025', '#00897b', '#c2185b', '#5f6368'];
function renderProfile() {
  let color = me.color;
  $('#profileCard').innerHTML = `
    <div class="profile-top"><div id="pAv">${avatar({ name: me.name, color }, 96)}</div>
      <div><h2 id="pTitle">${esc(me.name)}</h2><p class="verified"><span class="ms">verified</span>${esc(me.email)} \u2022 Email verified</p>
      <small class="hint">Member since ${fmtDate(me.createdAt)}</small></div></div>
    <div class="stack">
      <label class="field"><span>Display name</span><input id="pName" value="${esc(me.name)}" maxlength="40"></label>
      <label class="field"><span>About you</span><textarea id="pBio" maxlength="160" rows="3" placeholder="A short bio (optional)">${esc(me.bio)}</textarea></label>
      <div class="field"><span>Avatar colour</span><div class="swatches">${PALETTE.map(c => `<button class="sw ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
      <div class="modal-actions"><button class="btn ghost" id="pOut"><span class="ms">logout</span>Sign out</button><button class="btn primary" id="pSave">Save changes</button></div>
    </div>`;
  $('#pName').oninput = () => { $('#pAv').innerHTML = avatar({ name: $('#pName').value || 'A', color }, 96); };
  $('.swatches').onclick = e => {
    const c = e.target.dataset.c; if (!c) return;
    color = c; $$('.sw').forEach(s => s.classList.toggle('on', s.dataset.c === c));
    $('#pAv').innerHTML = avatar({ name: $('#pName').value || 'A', color }, 96);
  };
  $('#pOut').onclick = () => $('#logoutBtn').click();
  $('#pSave').onclick = async () => {
    try {
      me = await api('/me', { method: 'PUT', body: { name: $('#pName').value, bio: $('#pBio').value, color } });
      $('#avBtn').innerHTML = avatar(me, 36);
      $('#pTitle').textContent = me.name;
      toast('Profile saved');
    } catch (e) { toast(e.message, 'error'); }
  };
}