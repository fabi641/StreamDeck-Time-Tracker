const BACKEND = 'http://localhost:3847';
let ws = null, pluginUUID = null;
const buttons = {};

function connectElgatoStreamDeckSocket(port, uuid, registerEvent) {
  pluginUUID = uuid;
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onopen = () => { send({ event: registerEvent, uuid }); refreshStatus(); setInterval(refreshStatus, 8000); };
  ws.onmessage = evt => { const d = JSON.parse(evt.data); if (d.event === 'willAppear') { buttons[d.context] = { action: d.action, settings: d.payload.settings || {} }; } };
}

async function refreshStatus() {
  try {
    const r = await fetch(`${BACKEND}/api/status`);
    const s = await r.json();
    for (const [ctx, btn] of Object.entries(buttons)) {
      const label = btn.settings?.label || '●';
      setTitle(ctx, s.currentEntry ? `⏹ ${label}` : `▶ ${label}`);
    }
  } catch (_) {}
}

function send(obj) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function setTitle(ctx, title) { send({ event: 'setTitle', context: ctx, payload: { title } }); }
