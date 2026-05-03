/**
 * Smart Home – Camera Server (Face Detection)
 * Deploy pe Render ca Web Service (Node.js)
 *
 * Endpoint-uri:
 *  POST /api/face-detected   ← ESP32-CAM trimite imaginea
 *  GET  /api/latest-face     ← Android app cere ultima detecție
 *  GET  /api/face-history    ← Android app cere istoricul
 *  GET  /health              ← health-check Render
 */

const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_KEY      = process.env.API_KEY || '57271a26c9cf4eeec7fe46a91f2f4c81';
const MAX_HISTORY  = 20;   // câte detecții păstrăm în memorie
// ────────────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// multer – stocare în memorie (Render free nu are disk persistent)
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 5 * 1024 * 1024 }  // 5 MB max
});

// ─── STATE ─────────────────────────────────────────────────────────────────
/** @type {{ id: number, timestamp: string, imageBase64: string, confidence: number }[]} */
let faceHistory = [];
let detectionCounter = 0;
// ────────────────────────────────────────────────────────────────────────────

// ─── MIDDLEWARE: verificare API key ────────────────────────────────────────
function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (key !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
// ────────────────────────────────────────────────────────────────────────────

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/face-detected
 * Trimis de ESP32-CAM când detectează o față.
 *
 * Acceptă două formate:
 *  1. multipart/form-data  → câmpul "image" (JPEG binar) + opțional "confidence"
 *  2. application/json     → { "imageBase64": "<base64>", "confidence": 0.95 }
 */
app.post('/api/face-detected', requireApiKey, upload.single('image'), (req, res) => {
    try {
        let imageBase64 = null;
        let confidence  = 0;

        if (req.file) {
            // multipart/form-data
            imageBase64 = req.file.buffer.toString('base64');
            confidence  = parseFloat(req.body?.confidence ?? 0);
        } else if (req.body?.imageBase64) {
            // JSON cu base64
            imageBase64 = req.body.imageBase64;
            confidence  = parseFloat(req.body?.confidence ?? 0);
        } else {
            return res.status(400).json({ error: 'No image provided' });
        }

        detectionCounter++;
        const entry = {
            id:          detectionCounter,
            timestamp:   new Date().toISOString(),
            imageBase64: imageBase64,
            confidence:  confidence
        };

        // adaugă la început, menține maxim MAX_HISTORY
        faceHistory.unshift(entry);
        if (faceHistory.length > MAX_HISTORY) {
            faceHistory = faceHistory.slice(0, MAX_HISTORY);
        }

        console.log(`[${entry.timestamp}] Față detectată #${entry.id} (confidence: ${confidence})`);
        res.json({ ok: true, id: entry.id });

    } catch (err) {
        console.error('Eroare face-detected:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/latest-face
 * Returnează cea mai recentă detecție.
 * Dacă nu există nicio detecție → { detected: false }
 */
app.get('/api/latest-face', requireApiKey, (req, res) => {
    if (faceHistory.length === 0) {
        return res.json({ detected: false });
    }
    const latest = faceHistory[0];
    res.json({
        detected:    true,
        id:          latest.id,
        timestamp:   latest.timestamp,
        imageBase64: latest.imageBase64,
        confidence:  latest.confidence
    });
});

/**
 * GET /api/face-history?limit=10
 * Returnează istoricul detecțiilor (fără imagine, doar metadata).
 */
app.get('/api/face-history', requireApiKey, (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit ?? 10), MAX_HISTORY);
    const result = faceHistory.slice(0, limit).map(e => ({
        id:         e.id,
        timestamp:  e.timestamp,
        confidence: e.confidence
    }));
    res.json({ count: result.length, items: result });
});

/**
 * GET /api/face-image/:id
 * Returnează imaginea pentru un ID specific.
 */
app.get('/api/face-image/:id', requireApiKey, (req, res) => {
    const id    = parseInt(req.params.id);
    const entry = faceHistory.find(e => e.id === id);
    if (!entry) {
        return res.status(404).json({ error: 'Not found' });
    }
    // trimite ca JPEG direct
    const imgBuffer = Buffer.from(entry.imageBase64, 'base64');
    res.set('Content-Type', 'image/jpeg');
    res.send(imgBuffer);
});

// ─── START ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Smart Home Camera Server pornit pe portul ${PORT}`);
    console.log(`API Key activ: ${API_KEY.substring(0, 8)}...`);
});