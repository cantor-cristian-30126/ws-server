/**
 * Smart Home – Command Broker
 * Intermediar intre aplicatia Android si Raspberry Pi
 * Android trimite comenzi (start/stop), Pi le preia si raporteaza statusul
 */

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '57271a26c9cf4eeec7fe46a91f2f4c81';

app.use(cors());
app.use(express.json());

// ─── STATE ────────────────────────────────────────────────────────────────────
let pendingCommand = null;      // 'start' | 'stop' | null  – asteptata de Pi
let systemStatus   = 'stopped'; // 'running' | 'stopped'    – raportat de Pi
let lastStatusAt   = null;      // timestamp ultima actualizare Pi
// ─────────────────────────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace('Bearer ', '');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── ANDROID: trimite comanda (start / stop) ─────────────────────────────────
// POST /api/command  { "command": "start" }  sau  { "command": "stop" }
app.post('/api/command', requireApiKey, (req, res) => {
  const { command } = req.body;
  if (command !== 'start' && command !== 'stop') {
    return res.status(400).json({ error: 'Comanda invalida. Foloseste "start" sau "stop".' });
  }
  pendingCommand = command;
  console.log(`[Android] Comanda primita: ${command}`);
  res.json({ ok: true, command });
});

// ─── ANDROID: citeste statusul curent al sistemului ──────────────────────────
// GET /api/status
app.get('/api/status', requireApiKey, (req, res) => {
  res.json({
    status:      systemStatus,
    lastUpdated: lastStatusAt
  });
});

// ─── RASPBERRY PI: preia comanda pending ─────────────────────────────────────
// GET /api/pi/command  – Pi face polling la acest endpoint
// Returneaza comanda si o sterge dupa ce Pi-ul o preia
app.get('/api/pi/command', requireApiKey, (req, res) => {
  const cmd = pendingCommand;
  pendingCommand = null; // stergem dupa ce Pi a luat-o
  if (cmd) {
    console.log(`[Pi] Comanda preluata: ${cmd}`);
  }
  res.json({ command: cmd }); // null daca nu e nimic in asteptare
});

// ─── RASPBERRY PI: raporteaza statusul sau ───────────────────────────────────
// POST /api/pi/status  { "status": "running" }  sau  { "status": "stopped" }
app.post('/api/pi/status', requireApiKey, (req, res) => {
  const { status } = req.body;
  if (status !== 'running' && status !== 'stopped') {
    return res.status(400).json({ error: 'Status invalid. Foloseste "running" sau "stopped".' });
  }
  systemStatus = status;
  lastStatusAt = new Date().toISOString();
  console.log(`[Pi] Status actualizat: ${status}`);
  res.json({ ok: true });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:         'ok',
    uptime:         Math.floor(process.uptime()),
    systemStatus,
    pendingCommand,
    lastPiUpdateAt: lastStatusAt
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Broker pornit pe portul ${PORT}`);
});