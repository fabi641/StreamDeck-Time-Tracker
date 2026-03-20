/**
 * TimeTracker Stream Deck Plugin v2
 *
 * Buttons:
 *   de.timetracker.worktimer  – Arbeitstimer starten/stoppen
 *   de.timetracker.project    – Projekt aktivieren/deaktivieren (1 aktiv gleichzeitig)
 *   de.timetracker.daytotal   – Tagesarbeitszeit anzeigen (kein Klick-Effekt)
 */

const BACKEND = 'http://localhost:3847';
const POLL_INTERVAL = 2000; // Fallback-Polling alle 2s

let ws = null;
let pluginUUID = null;
let lastStatus = null;
let sseSource  = null; // Server-Sent Events für sofortige Updates

const buttons = {};

// ── WebSocket ──────────────────────────────────────────────────────────────────
function connectElgatoStreamDeckSocket(port, uuid, registerEvent) {
  pluginUUID = uuid;
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onopen = () => {
    send({ event: registerEvent, uuid });
    startPolling();
    connectSSE();
  };
  ws.onmessage = evt => handleSDEvent(JSON.parse(evt.data));
}

// ── SSE: sofortiger Push vom Backend ─────────────────────────────────────────
function connectSSE() {
  if (sseSource) sseSource.close();
  try {
    sseSource = new EventSource(`${BACKEND}/api/events`);
    sseSource.onmessage = evt => {
      try {
        const data = JSON.parse(evt.data);
        if (data.connected) return; // Willkommen-Nachricht ignorieren
        applyStatus(data);
      } catch (_) {}
    };
    sseSource.onerror = () => {
      // Bei Fehler SSE neu verbinden nach 3s
      sseSource.close();
      setTimeout(connectSSE, 3000);
    };
  } catch (_) {}
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Stream Deck Events ────────────────────────────────────────────────────────
function handleSDEvent({ action, event, context, payload }) {
  switch (event) {
    case 'willAppear':
      buttons[context] = { action, settings: payload.settings || {}, isActive: false };
      if (action === 'de.timetracker.project') {
        const label = payload.settings && payload.settings.label ? payload.settings.label : '●';
        setTitle(context, label);
      }
      break;
    case 'willDisappear':
      delete buttons[context];
      break;
    case 'didReceiveSettings':
      if (buttons[context]) {
        buttons[context].settings = payload.settings || {};
        // Titel sofort aktualisieren wenn Settings sich ändern
        if (buttons[context].action === 'de.timetracker.project') {
          const label = payload.settings?.label || '●';
          const isActive = payload.settings?.projectId === lastStatus?.activeProjectId;
          setTitle(context, isActive ? `● ${label}` : label);
          setState(context, isActive ? 1 : 0);
        }
      }
      break;
    case 'keyDown':
      handleKeyDown(action, context, payload);
      break;
  }
}

// ── Klick-Handler ─────────────────────────────────────────────────────────────
async function handleKeyDown(action, context, payload) {
  if (action === 'de.timetracker.daytotal') return; // nur Anzeige

  if (action === 'de.timetracker.worktimer') {
    try {
      await fetch(`${BACKEND}/api/worktimer/toggle`, { method: 'POST' });
      await refreshStatus();
    } catch (_) { setTitle(context, '❌ Offline'); }
    return;
  }

  if (action === 'de.timetracker.project') {
    const projectId = buttons[context]?.settings?.projectId;
    if (!projectId) { setTitle(context, '⚙️ Setup'); setTimeout(() => refreshStatus(), 2000); return; }
    try {
      await fetch(`${BACKEND}/api/project/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      await refreshStatus();
    } catch (_) { setTitle(context, '❌ Offline'); }
  }
}

// ── Status vom Backend holen und alle Buttons aktualisieren ───────────────────
async function refreshStatus() {
  try {
    const r = await fetch(`${BACKEND}/api/status`);
    applyStatus(await r.json());
  } catch (_) {
    for (const [ctx, btn] of Object.entries(buttons)) {
      if (btn.action === 'de.timetracker.daytotal') setTitle(ctx, '--:--');
      else setTitle(ctx, '❌');
    }
  }
}

function applyStatus(status) {
  if (!status) return;
  lastStatus = status;
  const { workTimer, activeProjectId, todaySeconds } = status;

  for (const [ctx, btn] of Object.entries(buttons)) {
    if (btn.action === 'de.timetracker.worktimer') {
      const active = workTimer.running;
      setState(ctx, active ? 1 : 0);
      setTitle(ctx, active ? '⏹ Stop' : '▶ Start');
    }

    if (btn.action === 'de.timetracker.project') {
      const myId  = btn.settings && btn.settings.projectId ? btn.settings.projectId : null;
      const label = btn.settings && btn.settings.label     ? btn.settings.label     : '●';
      const active = myId && myId === activeProjectId;
      setState(ctx, active ? 1 : 0);
      setTitle(ctx, active ? `● ${label}` : label);
    }

    if (btn.action === 'de.timetracker.daytotal') {
      // todaySeconds enthält nur abgeschlossene Einträge
      // laufenden Eintrag selbst addieren für korrekte Summe
      let total = status.todaySeconds || 0;
      if (status.currentEntry && status.workTimer && status.workTimer.running) {
        total += Math.floor((Date.now() - new Date(status.currentEntry.startTime)) / 1000);
      }
      setTitle(ctx, formatSeconds(total));
    }
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  refreshStatus();
  setInterval(refreshStatus, POLL_INTERVAL);
}

// ── SD Hilfsfunktionen ────────────────────────────────────────────────────────
function setTitle(context, title) {
  send({ event: 'setTitle', context, payload: { title: String(title) } });
}
function setState(context, state) {
  send({ event: 'setState', context, payload: { state } });
}

function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
