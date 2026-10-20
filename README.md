# Meetly

Video meetings with a whiteboard, file sharing, chat, calendar, call history and direct messages.

## Features
- Email-verified sign up (6-digit OTP)
- Multi-user video calls (WebRTC), screen sharing
- Whiteboard that stays beside the live video
- In-call chat and file sharing
- Meeting links, calendar scheduling, call history (with delete)
- Profile section and a separate one to one chat

## Run locally
```bash
cd backend
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm start
```
Open http://localhost:3000

Edit `backend/.env` to add your Gmail App Password for real verification emails.
Without it, the OTP is printed in the terminal.

## Tech
Node.js, Express, Socket.io, WebRTC, vanilla HTML/CSS/JS.