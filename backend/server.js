/**
 * TimeTracker Backend
 * Zustandsmodell:
 *   workTimer.running  – läuft die Arbeitszeit?
 *   activeProjectId    – aktuell ausgewähltes Projekt (null = keins)
 *   currentEntry       – offener Zeiteintrag (nur wenn Timer läuft)
 */
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
  if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const init = { workTimer: { running: false }, activeProjectId: null, currentEntry: null, entries: [], projects: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

function getProject(db, id) { return (db.projects || []).find(p => p.id === id) || null; }

function closeCurrentEntry(db) {
  if (!db.currentEntry) return;
  const endTime = new Date().toISOString();
  const duration = Math.floor((new Date(endTime) - new Date(db.currentEntry.startTime)) / 1000);
  if (duration > 0) db.entries.push({ ...db.currentEntry, endTime, duration });
  db.currentEntry = null;
}

function openEntry(db) {
  const proj = getProject(db, db.activeProjectId);
  db.currentEntry = {
    id: uuidv4(), projectId: proj?.id||null, projectName: proj?.name||'Kein Projekt',
    kostenstelle: proj?.kostenstelle||'', taetigkeit: proj?.taetigkeit||'',
    color: proj?.color||'#6b7280', startTime: new Date().toISOString(), endTime: null, duration: null, note: '',
  };
}


// ── SSE Push ──────────────────────────────────────────────────────────────────
const sseClients = new Set();

function pushStatusUpdate() {
  if (sseClients.size === 0) return;
  const db = loadDB();
  const today = new Date().toISOString().slice(0, 10);
  const todaySeconds = db.entries.filter(e => e.startTime.startsWith(today) && e.duration).reduce((s, e) => s + e.duration, 0);
  const payload = JSON.stringify({ workTimer: db.workTimer, activeProjectId: db.activeProjectId, currentEntry: db.currentEntry, todaySeconds });
  for (const res of sseClients) { try { res.write(`data: ${payload}\n\n`); } catch (_) { sseClients.delete(res); } }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: {"connected":true}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/status', (req, res) => {
  const db = loadDB();
  const today = new Date().toISOString().slice(0, 10);
  // Only completed entries — client adds running entry elapsed
  const todaySeconds = db.entries.filter(e => e.startTime.startsWith(today) && e.duration).reduce((s, e) => s + e.duration, 0);
  let currentSeconds = db.currentEntry ? Math.floor((Date.now() - new Date(db.currentEntry.startTime)) / 1000) : 0;
  res.json({ workTimer: db.workTimer, activeProjectId: db.activeProjectId, currentEntry: db.currentEntry, currentSeconds, todaySeconds, projects: db.projects || [] });
});

app.post('/api/worktimer/toggle', (req, res) => {
  const db = loadDB();
  if (db.workTimer.running) { closeCurrentEntry(db); db.workTimer = { running: false }; }
  else { db.workTimer = { running: true }; openEntry(db); }
  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true, workTimer: db.workTimer, currentEntry: db.currentEntry });
});

app.post('/api/project/select', (req, res) => {
  const db = loadDB();
  const { projectId } = req.body;
  const newId = db.activeProjectId === projectId ? null : (projectId || null);
  if (db.workTimer.running) { closeCurrentEntry(db); db.activeProjectId = newId; openEntry(db); }
  else { db.activeProjectId = newId; }
  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true, activeProjectId: db.activeProjectId, currentEntry: db.currentEntry });
});

app.get('/api/projects', (req, res) => { const db = loadDB(); res.json(db.projects || []); });
app.post('/api/projects', (req, res) => {
  const db = loadDB(); if (!db.projects) db.projects = [];
  const p = { id: uuidv4(), name: req.body.name||'', kostenstelle: req.body.kostenstelle||'', taetigkeit: req.body.taetigkeit||'', color: req.body.color||'#6366f1' };
  db.projects.push(p); saveDB(db); res.json(p);
});
app.put('/api/projects/:id', (req, res) => {
  const db = loadDB(); const p = (db.projects||[]).find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden.' });
  Object.assign(p, req.body); saveDB(db); res.json(p);
});
app.delete('/api/projects/:id', (req, res) => {
  const db = loadDB(); db.projects = (db.projects||[]).filter(p => p.id !== req.params.id);
  if (db.activeProjectId === req.params.id) db.activeProjectId = null;
  saveDB(db); res.json({ success: true });
});

app.get('/api/entries', (req, res) => {
  const db = loadDB(); let entries = db.entries;
  const { month, from, to } = req.query;
  if (from && to) entries = entries.filter(e => e.startTime >= from && e.startTime <= to + 'T23:59:59');
  else if (month) entries = entries.filter(e => e.startTime.startsWith(month));
  res.json(entries);
});
app.post('/api/entries', (req, res) => { const db = loadDB(); const e = { id: uuidv4(), ...req.body }; db.entries.push(e); saveDB(db); res.json(e); });
app.put('/api/entries/:id', (req, res) => {
  const db = loadDB(); const e = db.entries.find(e => e.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Nicht gefunden.' });
  Object.assign(e, req.body); saveDB(db); res.json(e);
});
app.delete('/api/entries/:id', (req, res) => {
  const db = loadDB(); db.entries = db.entries.filter(e => e.id !== req.params.id); saveDB(db); res.json({ success: true });
});

app.get('/api/summary', (req, res) => {
  const db = loadDB(); let { month, from, to } = req.query;
  let filterFn;
  if (from && to) filterFn = e => e.startTime >= from && e.startTime <= to + 'T23:59:59';
  else { if (!month) { const n = new Date(); month = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; } filterFn = e => e.startTime.startsWith(month); }
  const entries = db.entries.filter(e => filterFn(e) && e.duration);
  const byProject = {}, byActivity = {}, byDay = {};
  for (const e of entries) {
    const h = e.duration/3600, day = e.startTime.slice(0,10), key = e.projectName||'Kein Projekt', act = e.taetigkeit||'–';
    byProject[key] = (byProject[key]||0) + h; byActivity[act] = (byActivity[act]||0) + h; byDay[day] = (byDay[day]||0) + h;
  }
  res.json({ month, totalHours: Object.values(byProject).reduce((a,b) => a+b, 0), byProject, byActivity, byDay, entryCount: entries.length });
});

app.get('/api/export/csv', (req, res) => {
  const db = loadDB(); const { month, from, to } = req.query; let entries = db.entries;
  if (from && to) entries = entries.filter(e => e.startTime >= from && e.startTime <= to + 'T23:59:59');
  else if (month) entries = entries.filter(e => e.startTime.startsWith(month));
  const rows = [['Datum','Start','Ende','Projekt','Kostenstelle','Tätigkeit','Stunden','Notiz'].join(';'),
    ...entries.map(e => [e.startTime.slice(0,10),new Date(e.startTime).toLocaleTimeString('de-DE'),e.endTime?new Date(e.endTime).toLocaleTimeString('de-DE'):'',e.projectName,e.kostenstelle||'',e.taetigkeit||'',e.duration?(e.duration/3600).toFixed(2).replace('.',','):'',e.note||''].join(';'))];
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="zeiterfassung-${from&&to?`${from}_${to}`:month||'alle'}.csv"`);
  res.send('\uFEFF' + rows.join('\r\n'));
});

app.listen(PORT, () => console.log(`TimeTracker läuft auf http://localhost:${PORT}`));
