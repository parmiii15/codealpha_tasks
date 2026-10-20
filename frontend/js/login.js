const $ = s => document.querySelector(s);
const nextUrl = new URLSearchParams(location.search).get('next');
const go = () => { location.href = nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/'; };

if (store.token) api('/me', { noRedirect: true }).then(go).catch(() => { store.token = null; });

const showErr = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

/* tabs */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#signinForm').hidden = t.dataset.tab !== 'signin';
  $('#signupForm').hidden = t.dataset.tab !== 'signup';
});

/* OTP step */
let pendingEmail = '', timer = null;
const boxes = [...document.querySelectorAll('#otpRow input')];

function showOtp(email, msg) {
  pendingEmail = email;
  $('#stepAuth').hidden = true;
  $('#stepOtp').hidden = false;
  $('#otpMsg').textContent = msg || `We sent a 6-digit code to ${email}. It expires in 10 minutes.`;
  boxes.forEach(b => b.value = '');
  showErr($('#otpErr'), '');
  boxes[0].focus();
  startCooldown();
}
function startCooldown() {
  let s = 30;
  const btn = $('#resendBtn');
  btn.disabled = true;
  clearInterval(timer);
  timer = setInterval(() => {
    btn.textContent = s > 0 ? `Resend code in ${s}s` : 'Resend code';
    if (s-- <= 0) { clearInterval(timer); btn.disabled = false; }
  }, 1000);
  btn.textContent = 'Resend code in 30s';
}
boxes.forEach((b, i) => {
  b.addEventListener('input', () => {
    b.value = b.value.replace(/\D/g, '');
    if (b.value && boxes[i + 1]) boxes[i + 1].focus();
    if (boxes.every(x => x.value)) verify();
  });
  b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
  b.addEventListener('paste', e => {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!t) return;
    e.preventDefault();
    t.split('').forEach((c, k) => boxes[k].value = c);
    if (t.length === 6) verify(); else boxes[t.length].focus();
  });
});

async function verify() {
  const code = boxes.map(b => b.value).join('');
  if (code.length < 6) return showErr($('#otpErr'), 'Enter all 6 digits.');
  try {
    const d = await api('/auth/verify', { method: 'POST', body: { email: pendingEmail, code }, noRedirect: true });
    store.token = d.token;
    go();
  } catch (e) { showErr($('#otpErr'), e.message); }
}
$('#otpBtn').onclick = verify;
$('#otpBack').onclick = () => { $('#stepOtp').hidden = true; $('#stepAuth').hidden = false; };
$('#resendBtn').onclick = async () => {
  try { await api('/auth/resend', { method: 'POST', body: { email: pendingEmail }, noRedirect: true }); toast('A new code is on its way'); startCooldown(); }
  catch (e) { showErr($('#otpErr'), e.message); }
};

/* sign up */
$('#signupForm').onsubmit = async e => {
  e.preventDefault();
  showErr($('#suErr'), '');
  try {
    const email = $('#suEmail').value.trim();
    await api('/auth/register', { method: 'POST', noRedirect: true, body: { name: $('#suName').value, email, password: $('#suPass').value } });
    showOtp(email.toLowerCase());
  } catch (err) { showErr($('#suErr'), err.message); }
};

/* sign in */
$('#signinForm').onsubmit = async e => {
  e.preventDefault();
  showErr($('#siErr'), '');
  try {
    const d = await api('/auth/login', { method: 'POST', noRedirect: true, body: { email: $('#siEmail').value, password: $('#siPass').value } });
    store.token = d.token;
    go();
  } catch (err) {
    if (err.data && err.data.needsVerification) showOtp(err.data.email, 'Your email is not verified yet. We sent a fresh code to ' + err.data.email + '.');
    else showErr($('#siErr'), err.message);
  }
};