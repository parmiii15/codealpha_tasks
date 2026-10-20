// Tiny JSON-file database (no installation needed)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });

const data = { users: [], meetings: [], history: [], messages: [] };
if (fs.existsSync(FILE)) {
  try { Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { console.error('Could not read db.json, starting fresh:', e.message); }
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(data, null, 2), () => {}), 150);
}
function saveNow() { try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {} }
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

module.exports = { data, save };