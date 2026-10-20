const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const port = Number(process.env.SMTP_PORT || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendOtp(to, name, code) {
  if (!transport) {
    console.log(`\n=== DEV MODE (SMTP not set) ===\nVerification code for ${to}: ${code}\n===============================\n`);
    return;
  }
  await transport.sendMail({
    from: `"Meetly" <${process.env.SMTP_USER}>`,
    to,
    subject: `${code} is your Meetly verification code`,
    text: `Hi ${name}, your Meetly verification code is ${code}. It expires in 10 minutes.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:28px;border:1px solid #e0e0e0;border-radius:16px">
      <h2 style="margin:0 0 8px;color:#1a73e8">Meetly</h2>
      <p style="color:#444">Hi ${String(name).replace(/[<>&]/g, '')}, use this code to verify your email:</p>
      <div style="font-size:34px;letter-spacing:10px;font-weight:700;background:#f1f3f4;padding:16px;text-align:center;border-radius:12px">${code}</div>
      <p style="color:#777;font-size:13px">This code expires in 10 minutes. If you didn't sign up, ignore this email.</p></div>`,
  });
}

module.exports = { sendOtp };