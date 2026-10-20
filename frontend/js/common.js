/* Shared helpers used by every page */
const store = {
  get token() { return localStorage.getItem('token'); },
  set token(v) { v ? localStorage.setItem('token', v) : localStorage.removeItem('token'); },
};

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {} };
  if (store.token) o.headers.Authorization = 'Bearer ' + store.token;
  if (opts.body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, o);
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 401 && !opts.noRedirect) {
    store.token = null;
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('auth');
  }
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong. Please try again.'); e.data = d; e.status = r.status; throw e; }
  return d;
}

function requireAuth() {
  if (!store.token) location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = html => html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const initials = n => String(n).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (u, size) => `<span class="av" style="background:${u.color};${size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` : ''}">${esc(initials(u.name))}</span>`;
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmtDate = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'Under 1 min' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const meetLink = code => `${location.origin}/m/${code}`;

function toast(msg, type = '', action) {
  let root = document.getElementById('toasts');
  if (!root) { root = document.createElement('div'); root.id = 'toasts'; document.body.appendChild(root); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); t.remove(); };
    t.appendChild(b);
  }
  root.appendChild(t);
  setTimeout(() => t.remove(), action ? 12000 : 3800);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); }
  toast('Copied to clipboard');
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + store.token }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Upload failed.');
  return d;
}

/* renders a file attachment (image preview or file card) */
function fileHTML(f) {
  if (!f) return '';
  const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(f.type);
  if (isImg) return `<a href="${esc(f.url)}" target="_blank" class="att-img"><img src="${esc(f.url)}" alt="${esc(f.name)}"></a>`;
  return `<a class="att-file" href="${esc(f.url)}" download="${esc(f.name)}"><span class="ms">description</span><span class="att-meta"><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small></span><span class="ms">download</span></a>`;
}