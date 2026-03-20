const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app     = express();
const PORT    = 3847;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const WEB_DIR   = path.join(__dirname, '..', 'web');

app.use(cors());
app.use(express.json());
app.use(express.static(WEB_DIR));
app.get('/', (req, res) => res.sendFile(path.join(WEB_DIR, 'dashboard.html')));

function loadDB() {
  if (!fs.existsSync(path.dirname(DATA_FILE)))
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const init = { currentEntry: null, entries: [], projects: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

app.get('/api/status', (req, res) => {
  const db = loadDB();
  res.json({ currentEntry: db.currentEntry, projects: db.projects || [] });
});

app.post('/api/start', (req, res) => {
  const { project, activity, category, color } = req.body;
  if (!project) return res.status(400).json({ error: 'project ist Pflicht.' });
  const db = loadDB();
  if (db.currentEntry) {
    const endTime = new Date().toISOString();
    db.entries.push({ ...db.currentEntry, endTime, duration: Math.floor((new Date(endTime) - new Date(db.currentEntry.startTime)) / 1000) });
  }
  db.currentEntry = { id: uuidv4(), project, activity, category, color: color||'#6366f1', startTime: new Date().toISOString() };
  saveDB(db);
  res.json({ success: true, currentEntry: db.currentEntry });
});

app.post('/api/stop', (req, res) => {
  const db = loadDB();
  if (!db.currentEntry) return res.status(400).json({ error: 'Kein aktives Tracking.' });
  const endTime = new Date().toISOString();
  db.entries.push({ ...db.currentEntry, endTime, duration: Math.floor((new Date(endTime) - new Date(db.currentEntry.startTime)) / 1000) });
  db.currentEntry = null;
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/entries', (req, res) => {
  const db = loadDB();
  let entries = db.entries;
  if (req.query.month) entries = entries.filter(e => e.startTime.startsWith(req.query.month));
  res.json(entries);
});

app.delete('/api/entries/:id', (req, res) => {
  const db = loadDB();
  db.entries = db.entries.filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/projects', (req, res) => { const db = loadDB(); res.json(db.projects || []); });

app.post('/api/projects', (req, res) => {
  const db = loadDB();
  if (!db.projects) db.projects = [];
  const p = { id: uuidv4(), ...req.body };
  db.projects.push(p);
  saveDB(db);
  res.json(p);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = loadDB();
  db.projects = (db.projects||[]).filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`TimeTracker läuft auf http://localhost:${PORT}`));
