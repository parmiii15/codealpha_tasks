require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./db');
const { sendOtp } = require('./mailer');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const FRONT = path.join(__dirname, '..', 'frontend');
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
app.use(express.json({ limit: '1mb' }));

/* ---------------- helpers ---------------- */
const uid = () => crypto.randomBytes(8).toString('hex');
const letters = 'abcdefghijklmnopqrstuvwxyz';
const rnd = n => Array.from({ length: n }, () => letters[crypto.randomInt(26)]).join('');
const genCode = () => `${rnd(3)}-${rnd(4)}-${rnd(3)}`;
const COLORS = ['#1a73e8', '#e8710a', '#188038', '#a142f4', '#d93025', '#00897b', '#c2185b', '#5f6368'];
const online = new Map(); // userId -> Set(socketId)
const isOnline = id => online.has(id);

const pub = u => ({ id: u.id, name: u.name, email: u.email, bio: u.bio || '', color: u.color, createdAt: u.createdAt, verified: u.verified });
const token = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', SECRET);
    const u = db.data.users.find(x => x.id === p.id && x.verified);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}

/* ---------------- email OTP ---------------- */
const otps = new Map(); // email -> {code, exp, tries, last}
async function issueOtp(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  otps.set(user.email, { code, exp: Date.now() + 10 * 60e3, tries: 0, last: Date.now() });
  await sendOtp(user.email, user.name, code);
}

/* ---------------- auth routes ---------------- */
app.post('/api/auth/register', async (req, res) => {
  let { name, email, password } = req.body || {};
  name = String(name || '').trim().slice(0, 40);
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  let u = db.data.users.find(x => x.email === email);
  if (u && u.verified) return res.status(409).json({ error: 'This email is already registered. Please sign in.' });
  if (!u) {
    u = { id: uid(), email, verified: false, bio: '', color: COLORS[crypto.randomInt(COLORS.length)], createdAt: Date.now() };
    db.data.users.push(u);
  }
  u.name = name;
  u.pass = await bcrypt.hash(password, 10);
  db.save();
  try { await issueOtp(u); }
  catch (e) { console.error('Email error:', e.message); return res.status(500).json({ error: 'Could not send the verification email. Check the SMTP settings in backend/.env' }); }
  res.json({ ok: true, email });
});

app.post('/api/auth/verify', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const u = db.data.users.find(x => x.email === email);
  const o = otps.get(email);
  if (!u || !o) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  if (Date.now() > o.exp) { otps.delete(email); return res.status(400).json({ error: 'Code expired. Please request a new one.' }); }
  if (++o.tries > 5) { otps.delete(email); return res.status(429).json({ error: 'Too many attempts. Please request a new code.' }); }
  if (o.code !== code) return res.status(400).json({ error: 'That code is not correct.' });
  otps.delete(email);
  u.verified = true;
  db.save();
  res.json({ token: token(u), user: pub(u) });
});

app.post('/api/auth/resend', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.data.users.find(x => x.email === email && !x.verified);
  if (!u) return res.status(400).json({ error: 'Nothing to verify for this email.' });
  const o = otps.get(email);
  if (o && Date.now() - o.last < 30e3) return res.status(429).json({ error: 'Please wait a few seconds before requesting another code.' });
  try { await issueOtp(u); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'Could not send the email.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.data.users.find(x => x.email === email);
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.pass))) return res.status(400).json({ error: 'Wrong email or password.' });
  if (!u.verified) {
    try { await issueOtp(u); } catch {}
    return res.status(403).json({ error: 'Please verify your email. We sent you a new code.', needsVerification: true, email });
  }
  res.json({ token: token(u), user: pub(u) });
});

/* ---------------- profile ---------------- */
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));
app.put('/api/me', auth, (req, res) => {
  const { name, bio, color } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 40);
    if (n.length < 2) return res.status(400).json({ error: 'Name is too short.' });
    req.user.name = n;
  }
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 160);
  if (COLORS.includes(color)) req.user.color = color;
  db.save();
  res.json(pub(req.user));
});

/* ---------------- meetings (links + calendar) ---------------- */
app.post('/api/meetings', auth, (req, res) => {
  const { title, start } = req.body || {};
  let code;
  do { code = genCode(); } while (db.data.meetings.some(m => m.code === code));
  const s = start ? new Date(start) : null;
  if (s && isNaN(s)) return res.status(400).json({ error: 'Invalid date.' });
  const m = { id: uid(), code, hostId: req.user.id, title: String(title || '').trim().slice(0, 80) || 'Instant meeting', start: s ? s.toISOString() : null, createdAt: Date.now() };
  db.data.meetings.push(m);
  db.save();
  res.json(m);
});
app.get('/api/meetings', auth, (req, res) =>
  res.json(db.data.meetings.filter(m => m.hostId === req.user.id && m.start).sort((a, b) => a.start.localeCompare(b.start))));
app.get('/api/meetings/:code', auth, (req, res) => {
  const m = db.data.meetings.find(x => x.code === req.params.code.toLowerCase());
  if (!m) return res.status(404).json({ error: 'Meeting not found. Check the code and try again.' });
  res.json({ code: m.code, title: m.title, start: m.start });
});
app.delete('/api/meetings/:id', auth, (req, res) => {
  const i = db.data.meetings.findIndex(m => m.id === req.params.id && m.hostId === req.user.id);
  if (i < 0) return res.status(404).json({ error: 'Meeting not found.' });
  db.data.meetings.splice(i, 1);
  db.save();
  res.json({ ok: true });
});

/* ---------------- call history ---------------- */
app.get('/api/history', auth, (req, res) =>
  res.json(db.data.history.filter(h => h.userId === req.user.id).sort((a, b) => b.joinedAt - a.joinedAt)));
app.delete('/api/history/:id', auth, (req, res) => {
  db.data.history = db.data.history.filter(h => !(h.id === req.params.id && h.userId === req.user.id));
  db.save();
  res.json({ ok: true });
});
app.delete('/api/history', auth, (req, res) => {
  db.data.history = db.data.history.filter(h => h.userId !== req.user.id);
  db.save();
  res.json({ ok: true });
});

/* ---------------- chat  ---------------- */
app.get('/api/users', auth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  res.json(db.data.users
    .filter(u => u.verified && u.id !== req.user.id && (u.name.toLowerCase().includes(q) || u.email.includes(q)))
    .slice(0, 20).map(pub));
});
app.get('/api/chats', auth, (req, res) => {
  const me = req.user.id, map = new Map();
  for (const m of db.data.messages) {
    if (m.from !== me && m.to !== me) continue;
    const other = m.from === me ? m.to : m.from;
    const c = map.get(other) || { last: null, unread: 0 };
    c.last = m;
    if (m.to === me && !m.read) c.unread++;
    map.set(other, c);
  }
  const list = [];
  for (const [id, c] of map) {
    const u = db.data.users.find(x => x.id === id);
    if (u) list.push({ user: pub(u), last: c.last, unread: c.unread });
  }
  res.json(list.sort((a, b) => b.last.time - a.last.time));
});
app.get('/api/messages/:uid', auth, (req, res) => {
  const me = req.user.id, other = req.params.uid;
  const u = db.data.users.find(x => x.id === other);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const msgs = db.data.messages.filter(m => (m.from === me && m.to === other) || (m.from === other && m.to === me));
  res.json({ user: pub(u), messages: msgs.slice(-300) });
});

/* ---------------- file upload ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (r, f, cb) => cb(null, uid() + path.extname(f.originalname).slice(0, 10).replace(/[^.\w]/g, '')),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 25 MB).' : 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    res.json({ name: req.file.originalname, url: '/uploads/' + req.file.filename, size: req.file.size, type: req.file.mimetype });
  });
});
app.use('/uploads', express.static(UPLOADS, {
  setHeaders: (res, fp) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!/\.(png|jpe?g|gif|webp|pdf|mp4|webm|mp3)$/i.test(fp)) res.setHeader('Content-Disposition', 'attachment');
  },
}));

/* ---------------- frontend ---------------- */
app.use(express.static(FRONT));
app.get('/m/:code', (req, res) => res.sendFile(path.join(FRONT, 'meeting.html')));

/* ---------------- sockets ---------------- */
const rooms = new Map(); // code -> { peers: Map(socketId -> info), chat: [], seg: [], names: Set }

io.use((s, next) => {
  try {
    const p = jwt.verify(s.handshake.auth.token, SECRET);
    const u = db.data.users.find(x => x.id === p.id && x.verified);
    if (!u) throw new Error('no user');
    s.user = u;
    next();
  } catch { next(new Error('auth')); }
});

const cleanFile = f => (f && typeof f.url === 'string' && f.url.startsWith('/uploads/'))
  ? { name: String(f.name).slice(0, 120), url: f.url, size: Number(f.size) || 0, type: String(f.type || '') } : null;

function leaveRoom(s) {
  const code = s.data.code;
  if (!code) return;
  const r = rooms.get(code);
  s.leave('room:' + code);
  s.data.code = null;
  if (r) {
    r.peers.delete(s.id);
    io.to('room:' + code).emit('meet:peer-left', { id: s.id });
    if (!r.peers.size) rooms.delete(code);
  }
  const h = s.data.hist;
  if (h) {
    h.leftAt = Date.now();
    h.participants = r ? [...r.names].filter(n => n !== s.user.name) : [];
    s.data.hist = null;
    db.save();
  }
}

io.on('connection', s => {
  const u = s.user;
  s.join('user:' + u.id);
  if (!online.has(u.id)) online.set(u.id, new Set());
  online.get(u.id).add(s.id);
  io.emit('presence', { userId: u.id, online: true });
  s.emit('presence:list', [...online.keys()]);

  /* direct messages */
  s.on('dm:send', ({ to, text, file } = {}) => {
    text = String(text || '').slice(0, 4000);
    file = cleanFile(file);
    if (!text.trim() && !file) return;
    if (!db.data.users.some(x => x.id === to && x.verified)) return;
    const m = { id: uid(), from: u.id, to, text, file, time: Date.now(), read: false };
    db.data.messages.push(m);
    db.save();
    io.to('user:' + to).to('user:' + u.id).emit('dm:new', m);
  });
  s.on('dm:typing', ({ to } = {}) => io.to('user:' + to).emit('dm:typing', { from: u.id }));
  s.on('dm:read', ({ from } = {}) => {
    let changed = false;
    for (const m of db.data.messages) if (m.from === from && m.to === u.id && !m.read) { m.read = true; changed = true; }
    if (changed) { db.save(); io.to('user:' + from).emit('dm:read', { by: u.id }); }
  });

  /* meetings */
  s.on('meet:join', ({ code } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const meet = db.data.meetings.find(m => m.code === code);
    if (!meet) return ack({ error: 'Meeting not found.' });
    leaveRoom(s);
    let r = rooms.get(code);
    if (!r) { r = { peers: new Map(), chat: [], seg: [], names: new Set() }; rooms.set(code, r); }
    if (r.peers.size >= 8) return ack({ error: 'This meeting is full (max 8 people).' });
    const info = { id: s.id, userId: u.id, name: u.name, color: u.color, mic: true, cam: true, sharing: false };
    const existing = [...r.peers.values()];
    r.peers.set(s.id, info);
    r.names.add(u.name);
    s.join('room:' + code);
    s.data.code = code;
    const h = { id: uid(), userId: u.id, code, title: meet.title, joinedAt: Date.now(), leftAt: null, participants: [] };
    db.data.history.push(h);
    s.data.hist = h;
    db.save();
    s.to('room:' + code).emit('meet:peer-joined', info);
    ack({ me: info, peers: existing, chat: r.chat, seg: r.seg, title: meet.title });
  });
  s.on('meet:leave', () => leaveRoom(s));

  s.on('signal', ({ to, data } = {}) => {
    const t = io.sockets.sockets.get(to);
    if (t && s.data.code && t.data.code === s.data.code) t.emit('signal', { from: s.id, data });
  });
  s.on('meet:media', st => {
    const r = rooms.get(s.data.code), p = r && r.peers.get(s.id);
    if (!p || !st) return;
    p.mic = !!st.mic; p.cam = !!st.cam; p.sharing = !!st.sharing;
    s.to('room:' + s.data.code).emit('meet:media', { id: s.id, mic: p.mic, cam: p.cam, sharing: p.sharing });
  });
  s.on('meet:chat', ({ text, file } = {}) => {
    const r = rooms.get(s.data.code);
    if (!r) return;
    text = String(text || '').slice(0, 2000);
    file = cleanFile(file);
    if (!text.trim() && !file) return;
    const msg = { id: uid(), from: s.id, name: u.name, color: u.color, text, file, time: Date.now() };
    r.chat.push(msg);
    if (r.chat.length > 300) r.chat.shift();
    io.to('room:' + s.data.code).emit('meet:chat', msg);
  });

  /* whiteboard */
  s.on('wb:seg', g => {
    const r = rooms.get(s.data.code);
    if (!r || !g || !Array.isArray(g.a) || !Array.isArray(g.b)) return;
    const n = v => Math.max(0, Math.min(1, Number(v) || 0));
    const seg = { c: String(g.c).slice(0, 9), w: Math.max(1, Math.min(60, Number(g.w) || 4)), a: [n(g.a[0]), n(g.a[1])], b: [n(g.b[0]), n(g.b[1])] };
    r.seg.push(seg);
    if (r.seg.length > 30000) r.seg.splice(0, 5000);
    s.to('room:' + s.data.code).emit('wb:seg', seg);
  });
  s.on('wb:clear', () => {
    const r = rooms.get(s.data.code);
    if (!r) return;
    r.seg.length = 0;
    s.to('room:' + s.data.code).emit('wb:clear');
  });

  s.on('disconnect', () => {
    leaveRoom(s);
    const set = online.get(u.id);
    if (set) { set.delete(s.id); if (!set.size) { online.delete(u.id); io.emit('presence', { userId: u.id, online: false }); } }
  });
});

server.listen(PORT, () => console.log(`\nMeetly is running →  http://localhost:${PORT}\n`));