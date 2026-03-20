/**
 * TimeTracker Backend v2
 * Port 3847
 *
 * Zustandsmodell:
 *   workTimer.running  – läuft die Arbeitszeit gerade?
 *   activeProjectId    – welches Projekt ist gerade ausgewählt? (null = kein Projekt)
 *   currentEntry       – der aktuell offene Zeiteintrag (nur wenn workTimer läuft)
 *
 * Regeln:
 *   - Arbeitstimer starten → currentEntry für activeProject (oder "Kein Projekt") öffnen
 *   - Projekt wechseln während Timer läuft → currentEntry schließen, neuen öffnen
 *   - Arbeitstimer stoppen → currentEntry schließen, activeProjectId bleibt erhalten
 *   - Projekt wechseln während Timer gestoppt → nur activeProjectId setzen, kein Eintrag
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const XLSX    = require('xlsx');

const app     = express();
const PORT    = 3847;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const WEB_DIR   = path.join(__dirname, '..', 'web');

app.use(cors());
app.use(express.json());
app.use(express.static(WEB_DIR));
app.get('/', (req, res) => res.sendFile(path.join(WEB_DIR, 'dashboard.html')));

// ── SSE: Push-Benachrichtigung bei Statusänderungen ───────────────────────────
// Stream Deck Plugin und Dashboard können sich hier eintragen und bekommen
// sofort ein Event wenn sich Timer oder Projekt ändert.
const sseClients = new Set();

function pushStatusUpdate() {
  if (sseClients.size === 0) return;
  const db = loadDB();
  const today = new Date().toISOString().slice(0, 10);
  const todaySeconds = db.entries
    .filter(e => e.startTime.startsWith(today) && e.duration)
    .reduce((s, e) => s + e.duration, 0);
  const payload = JSON.stringify({
    workTimer:       db.workTimer,
    activeProjectId: db.activeProjectId,
    currentEntry:    db.currentEntry,
    todaySeconds,
  });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch (_) { sseClients.delete(res); }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write('data: {"connected":true}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── Persistenz ────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(path.dirname(DATA_FILE)))
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const init = { workTimer: { running: false }, activeProjectId: null, currentEntry: null, entries: [], projects: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function getProject(db, id) {
  return (db.projects || []).find(p => p.id === id) || null;
}

function closeCurrentEntry(db) {
  if (!db.currentEntry) return;
  const endTime  = new Date().toISOString();
  const duration = Math.floor((new Date(endTime) - new Date(db.currentEntry.startTime)) / 1000);
  if (duration > 0) db.entries.push({ ...db.currentEntry, endTime, duration });
  db.currentEntry = null;
}

function openEntry(db) {
  const proj = getProject(db, db.activeProjectId);
  db.currentEntry = {
    id:           uuidv4(),
    projectId:    proj ? proj.id   : null,
    projectName:  proj ? proj.name : 'Kein Projekt',
    kostenstelle: proj ? proj.kostenstelle : '',
    taetigkeit:   proj ? proj.taetigkeit   : '',
    color:        proj ? proj.color        : '#6b7280',
    startTime:    new Date().toISOString(),
    endTime:      null,
    duration:     null,
    note:         '',
  };
}

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const db = loadDB();
  const today = new Date().toISOString().slice(0, 10);

  // Nur abgeschlossene Einträge zählen — laufender Eintrag wird vom Client addiert
  const todaySeconds = db.entries
    .filter(e => e.startTime.startsWith(today) && e.duration)
    .reduce((s, e) => s + e.duration, 0);

  let currentSeconds = 0;
  if (db.currentEntry)
    currentSeconds = Math.floor((Date.now() - new Date(db.currentEntry.startTime)) / 1000);

  res.json({
    workTimer:       db.workTimer,
    activeProjectId: db.activeProjectId,
    currentEntry:    db.currentEntry,
    currentSeconds,
    todaySeconds,
    projects:        db.projects || [],
  });
});

// ── Arbeitstimer ──────────────────────────────────────────────────────────────
app.post('/api/worktimer/start', (req, res) => {
  const db = loadDB();
  if (db.workTimer.running) return res.json({ success: false, message: 'Läuft bereits.' });
  db.workTimer = { running: true, startTime: new Date().toISOString() };
  openEntry(db);
  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true, workTimer: db.workTimer, currentEntry: db.currentEntry });
});

app.post('/api/worktimer/stop', (req, res) => {
  const db = loadDB();
  if (!db.workTimer.running) return res.json({ success: false, message: 'Läuft nicht.' });
  closeCurrentEntry(db);
  db.workTimer = { running: false };
  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true });
});

app.post('/api/worktimer/toggle', (req, res) => {
  const db = loadDB();
  if (db.workTimer.running) {
    closeCurrentEntry(db);
    db.workTimer = { running: false };
  } else {
    db.workTimer = { running: true, startTime: new Date().toISOString() };
    openEntry(db);
  }
  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true, workTimer: db.workTimer, currentEntry: db.currentEntry });
});

// ── Projekt auswählen ─────────────────────────────────────────────────────────
// { projectId: "..." }  oder  { projectId: null }  zum Deaktivieren
app.post('/api/project/select', (req, res) => {
  const db = loadDB();
  const { projectId } = req.body;

  // Toggle: nochmal dasselbe Projekt → deaktivieren
  const newId = db.activeProjectId === projectId ? null : (projectId || null);

  if (db.workTimer.running) {
    // Splitt: alten Eintrag schließen, neuen öffnen
    closeCurrentEntry(db);
    db.activeProjectId = newId;
    openEntry(db);
  } else {
    db.activeProjectId = newId;
  }

  saveDB(db);
  pushStatusUpdate();
  res.json({ success: true, activeProjectId: db.activeProjectId, currentEntry: db.currentEntry });
});

// ── Projekte verwalten ────────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => {
  const db = loadDB();
  res.json(db.projects || []);
});

app.post('/api/projects', (req, res) => {
  const { name, kostenstelle, taetigkeit, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist Pflicht.' });
  const db = loadDB();
  if (!db.projects) db.projects = [];
  const project = { id: uuidv4(), name, kostenstelle: kostenstelle||'', taetigkeit: taetigkeit||'', color: color||'#6366f1' };
  db.projects.push(project);
  saveDB(db);
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const p = (db.projects||[]).find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Nicht gefunden.' });
  Object.assign(p, req.body);
  saveDB(db);
  res.json(p);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = loadDB();
  db.projects = (db.projects||[]).filter(p => p.id !== req.params.id);
  if (db.activeProjectId === req.params.id) db.activeProjectId = null;
  saveDB(db);
  res.json({ success: true });
});

// ── Einträge ──────────────────────────────────────────────────────────────────
app.get('/api/entries', (req, res) => {
  const db = loadDB();
  const { month, from, to } = req.query;
  let entries = db.entries;
  if (from && to)    entries = entries.filter(e => e.startTime >= from && e.startTime <= to + 'T23:59:59');
  else if (month)    entries = entries.filter(e => e.startTime.startsWith(month));
  res.json(entries);
});

app.post('/api/entries', (req, res) => {
  const db = loadDB();
  const entry = { id: uuidv4(), ...req.body };
  db.entries.push(entry);
  saveDB(db);
  res.json(entry);
});

app.put('/api/entries/:id', (req, res) => {
  const db = loadDB();
  const e = db.entries.find(e => e.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Nicht gefunden.' });
  Object.assign(e, req.body);
  saveDB(db);
  res.json(e);
});

app.delete('/api/entries/:id', (req, res) => {
  const db = loadDB();
  db.entries = db.entries.filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ── Auswertung ────────────────────────────────────────────────────────────────
app.get('/api/summary', (req, res) => {
  const db = loadDB();
  let { month, from, to } = req.query;

  // from/to haben Vorrang vor month
  let filterFn;
  if (from && to) {
    filterFn = e => e.startTime >= from && e.startTime <= to + 'T23:59:59';
  } else {
    if (!month) { const n = new Date(); month = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; }
    filterFn = e => e.startTime.startsWith(month);
  }

  const entries = db.entries.filter(e => filterFn(e) && e.duration);

  const byProject  = {};
  const byActivity = {};
  const byDay      = {};

  for (const e of entries) {
    const h   = e.duration / 3600;
    const day = e.startTime.slice(0, 10);
    const key = e.projectName || 'Kein Projekt';
    const act = e.taetigkeit  || '–';
    byProject[key]  = (byProject[key]  || 0) + h;
    byActivity[act] = (byActivity[act] || 0) + h;
    byDay[day]      = (byDay[day]      || 0) + h;
  }

  const totalHours = Object.values(byProject).reduce((a,b) => a+b, 0);
  res.json({ month, totalHours, byProject, byActivity, byDay, entryCount: entries.length });
});

// ── CSV Export ────────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const db = loadDB();
  const { month, from, to } = req.query;
  let entries = db.entries;
  if (from && to)    entries = entries.filter(e => e.startTime >= from && e.startTime <= to + 'T23:59:59');
  else if (month)    entries = entries.filter(e => e.startTime.startsWith(month));
  const label = from && to ? `${from}_${to}` : (month || 'alle');
  const rows = [
    ['Datum','Start','Ende','Projekt','Kostenstelle','Tätigkeit','Stunden','Notiz'].join(';'),
    ...entries.map(e => [
      e.startTime.slice(0,10),
      new Date(e.startTime).toLocaleTimeString('de-DE'),
      e.endTime ? new Date(e.endTime).toLocaleTimeString('de-DE') : '',
      e.projectName, e.kostenstelle||'', e.taetigkeit||'',
      e.duration ? (e.duration/3600).toFixed(2).replace('.',',') : '',
      e.note||'',
    ].join(';'))
  ];
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="zeiterfassung-${label}.csv"`);
  res.send('\uFEFF' + rows.join('\r\n'));
});

// ── Excel Export (.xlsx) ──────────────────────────────────────────────────────
app.get('/api/export/xlsx', (req, res) => {
  const db = loadDB();
  const { month, from, to } = req.query;

  let entries = db.entries.filter(e => e.duration);
  if (from && to)    entries = entries.filter(e => e.startTime >= from && e.startTime <= to + 'T23:59:59');
  else if (month)    entries = entries.filter(e => e.startTime.startsWith(month));

  const label = from && to ? `${from} – ${to}` : (month || 'Alle');

  // ── Hilfsfunktionen ──
  const h2str = h => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${hh}:${String(mm).padStart(2,'0')}`;
  };
  const fmtDate = iso => new Date(iso+'T12:00').toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});

  // ── Reiter 1: Zusammenfassung ─────────────────────────────────────────────
  const byProject = {};
  for (const e of entries) {
    const key = e.projectName || 'Kein Projekt';
    if (!byProject[key]) byProject[key] = { kostenstelle: e.kostenstelle||'', taetigkeit: e.taetigkeit||'', seconds: 0, days: new Set() };
    byProject[key].seconds += e.duration;
    byProject[key].days.add(e.startTime.slice(0,10));
  }

  const summaryRows = [
    ['Projekt', 'Kostenstelle', 'Tätigkeitstyp', 'Arbeitstage', 'Stunden (dezimal)', 'Stunden (HH:MM)'],
  ];
  let totalSec = 0;
  for (const [name, d] of Object.entries(byProject).sort((a,b) => b[1].seconds - a[1].seconds)) {
    const h = d.seconds / 3600;
    summaryRows.push([name, d.kostenstelle, d.taetigkeit, d.days.size, +h.toFixed(2), h2str(h)]);
    totalSec += d.seconds;
  }
  summaryRows.push([]); // Leerzeile
  summaryRows.push(['GESAMT', '', '', '', +( totalSec/3600).toFixed(2), h2str(totalSec/3600)]);

  const wsSum = XLSX.utils.aoa_to_sheet(summaryRows);

  // Spaltenbreiten
  wsSum['!cols'] = [
    {wch:30},{wch:18},{wch:22},{wch:13},{wch:18},{wch:14}
  ];

  // Kopfzeile fett + Hintergrund (basic styling)
  const headerStyle = { font:{bold:true}, fill:{fgColor:{rgb:'3B3F5C'}}, alignment:{horizontal:'center'} };
  ['A1','B1','C1','D1','E1','F1'].forEach(ref => {
    if (wsSum[ref]) wsSum[ref].s = headerStyle;
  });

  // Summenzeile fett
  const sumRow = summaryRows.length;
  [`A${sumRow}`,`E${sumRow}`,`F${sumRow}`].forEach(ref => {
    if (wsSum[ref]) wsSum[ref].s = { font:{bold:true} };
  });

  // ── Reiter 2: Tagesverlauf ────────────────────────────────────────────────
  // Alle Projekte × alle Tage als Matrix
  const allProjects = Object.keys(byProject).sort();
  const allDays     = [...new Set(entries.map(e => e.startTime.slice(0,10)))].sort();

  // Stunden pro Tag pro Projekt
  const dayProjMap = {};
  for (const e of entries) {
    const day  = e.startTime.slice(0,10);
    const proj = e.projectName || 'Kein Projekt';
    if (!dayProjMap[day]) dayProjMap[day] = {};
    dayProjMap[day][proj] = (dayProjMap[day][proj] || 0) + e.duration / 3600;
  }

  const dailyHeader = ['Datum', ...allProjects, 'Tagessumme'];
  const dailyRows   = [dailyHeader];
  for (const day of allDays) {
    const row = [fmtDate(day)];
    let dayTotal = 0;
    for (const proj of allProjects) {
      const h = dayProjMap[day]?.[proj] || 0;
      row.push(h > 0 ? +h.toFixed(2) : '');
      dayTotal += h;
    }
    row.push(+dayTotal.toFixed(2));
    dailyRows.push(row);
  }
  // Summenzeile
  const sumRow2 = ['GESAMT'];
  for (const proj of allProjects) {
    const s = entries.filter(e => (e.projectName||'Kein Projekt') === proj).reduce((a,e) => a + e.duration/3600, 0);
    sumRow2.push(+s.toFixed(2));
  }
  sumRow2.push(+(totalSec/3600).toFixed(2));
  dailyRows.push([]);
  dailyRows.push(sumRow2);

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  wsDaily['!cols'] = [
    {wch:14},
    ...allProjects.map(() => ({wch:18})),
    {wch:14}
  ];
  ['A1',...allProjects.map((_,i) => String.fromCharCode(66+i)+'1'), String.fromCharCode(66+allProjects.length)+'1'].forEach(ref => {
    if (wsDaily[ref]) wsDaily[ref].s = headerStyle;
  });

  // ── Reiter 3: Roheinträge ─────────────────────────────────────────────────
  const rawHeader = ['Datum','Start','Ende','Dauer (h)','Projekt','Kostenstelle','Tätigkeitstyp','Notiz'];
  const rawRows   = [rawHeader];
  for (const e of [...entries].sort((a,b) => a.startTime.localeCompare(b.startTime))) {
    rawRows.push([
      e.startTime.slice(0,10),
      new Date(e.startTime).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}),
      e.endTime ? new Date(e.endTime).toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}) : '',
      +(e.duration/3600).toFixed(2),
      e.projectName || '',
      e.kostenstelle || '',
      e.taetigkeit   || '',
      e.note         || '',
    ]);
  }
  const wsRaw = XLSX.utils.aoa_to_sheet(rawRows);
  wsRaw['!cols'] = [{wch:12},{wch:8},{wch:8},{wch:11},{wch:28},{wch:18},{wch:22},{wch:30}];
  ['A1','B1','C1','D1','E1','F1','G1','H1'].forEach(ref => {
    if (wsRaw[ref]) wsRaw[ref].s = headerStyle;
  });

  // ── Workbook zusammenbauen ────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum,   'Zusammenfassung');
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Tagesverlauf');
  XLSX.utils.book_append_sheet(wb, wsRaw,   'Roheintraege');

  const filename = `Zeiterfassung_${label.replace(/\s/g,'_').replace(/–/g,'-')}.xlsx`;
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

app.listen(PORT, () => {
  console.log(`✅ TimeTracker läuft auf http://localhost:${PORT}`);
});
