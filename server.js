const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY     = process.env.API_KEY     || '57271a26c9cf4eeec7fe46a91f2f4c81';
const PROJECT_ID  = process.env.FCM_PROJECT_ID  || 'notificari-7c8d6';

app.use(cors());
app.use(express.json());

// ─── STATE ────────────────────────────────────────────────────────────────────
let pendingCommand = null;
let systemStatus   = 'stopped';
let lastStatusAt   = null;
let fcmTokens      = [];        // tokenii FCM ai dispozitivelor Android
let fcmAccessToken = null;
let fcmTokenExpiry = 0;
// ─────────────────────────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace('Bearer ', '');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── FCM: obtine access token prin Service Account ───────────────────────────
async function getFcmAccessToken() {
  if (fcmAccessToken && Date.now() < fcmTokenExpiry) return fcmAccessToken;

  const fs = require('fs');
  const serviceAccount = JSON.parse(fs.readFileSync('/etc/secrets/service-account.json', 'utf8'));
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  // Codifica JWT manual (fara librarie externa)
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const toSign  = `${header}.${payload}`;

  const crypto = require('crypto');
  const sign   = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${toSign}.${signature}`;

  // Schimba JWT pe access token
  const tokenResponse = await new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  fcmAccessToken = tokenResponse.access_token;
  fcmTokenExpiry = Date.now() + (tokenResponse.expires_in - 60) * 1000;
  return fcmAccessToken;
}

// ─── FCM: trimite notificare ──────────────────────────────────────────────────
async function sendFcmNotification(title, body) {
  if (fcmTokens.length === 0) {
    console.log('[FCM] Niciun token inregistrat, skip notificare.');
    return;
  }

  try {
    const accessToken = await getFcmAccessToken();

    for (const token of fcmTokens) {
      const message = JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: { priority: 'high' }
        }
      });

      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'fcm.googleapis.com',
          path: `/v1/projects/${PROJECT_ID}/messages:send`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(message)
          }
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`[FCM] Notificare trimisa (${res.statusCode}): ${data}`);
            resolve();
          });
        });
        req.on('error', reject);
        req.write(message);
        req.end();
      });
    }
  } catch (err) {
    console.error('[FCM] Eroare la trimitere notificare:', err.message);
  }
}

// ─── ANDROID: inregistreaza token FCM ────────────────────────────────────────
// POST /api/register-token  { "token": "fcm_token_here" }
app.post('/api/register-token', requireApiKey, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token lipsa.' });
  if (!fcmTokens.includes(token)) {
    fcmTokens.push(token);
    console.log(`[Android] Token FCM inregistrat. Total: ${fcmTokens.length}`);
  }
  res.json({ ok: true });
});

// ─── ANDROID: trimite comanda ─────────────────────────────────────────────────
app.post('/api/command', requireApiKey, (req, res) => {
  const { command } = req.body;
  if (command !== 'start' && command !== 'stop') {
    return res.status(400).json({ error: 'Comanda invalida.' });
  }
  pendingCommand = command;
  console.log(`[Android] Comanda primita: ${command}`);
  res.json({ ok: true, command });
});

// ─── ANDROID: citeste status ──────────────────────────────────────────────────
app.get('/api/status', requireApiKey, (req, res) => {
  res.json({ status: systemStatus, lastUpdated: lastStatusAt });
});

// ─── PI: preia comanda pending ────────────────────────────────────────────────
app.get('/api/pi/command', requireApiKey, (req, res) => {
  const cmd = pendingCommand;
  pendingCommand = null;
  if (cmd) console.log(`[Pi] Comanda preluata: ${cmd}`);
  res.json({ command: cmd });
});

// ─── PI: raporteaza status ────────────────────────────────────────────────────
app.post('/api/pi/status', requireApiKey, (req, res) => {
  const { status } = req.body;
  if (status !== 'running' && status !== 'stopped') {
    return res.status(400).json({ error: 'Status invalid.' });
  }
  systemStatus = status;
  lastStatusAt = new Date().toISOString();
  console.log(`[Pi] Status actualizat: ${status}`);
  res.json({ ok: true });
});

// ─── PI: raporteaza detectie faciala ─────────────────────────────────────────
// POST /api/pi/face-detected  { "name": "cristi" }
app.post('/api/pi/face-detected', requireApiKey, (req, res) => {
  const { name } = req.body;
  const displayName = name || 'Cineva';
  console.log(`[Pi] Fata detectata: ${displayName}`);
  sendFcmNotification(
    '🔐 Fata Detectata',
    `${displayName} a fost recunoscut. Yala s-a deschis.`
  );
  res.json({ ok: true });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    systemStatus,
    pendingCommand,
    registeredTokens: fcmTokens.length,
    lastPiUpdateAt: lastStatusAt
  });
});

app.listen(PORT, () => console.log(`Broker pornit pe portul ${PORT}`));