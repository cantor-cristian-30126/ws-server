/**
 * Smart Home – Camera Server cu detecție facială server-side
 * Primeşte JPEG de la ESP32-CAM, detectează fețe, notifică Android.
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '57271a26c9cf4eeec7fe46a91f2f4c81';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'image/jpeg', limit: '5mb' }));

// ─── STATE ──────────────────────────────────────────────────────────────────
let faceHistory    = [];
let detectionCount = 0;
let faceDetector   = null;
let modelsLoaded   = false;
// ────────────────────────────────────────────────────────────────────────────

// ─── AUTH ────────────────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── INIȚIALIZARE face-api.js ────────────────────────────────────────────────
async function loadFaceDetector() {
  try {
    const faceapi = require('@vladmandic/face-api');
    const tf      = require('@tensorflow/tfjs-node');
    const canvas  = require('canvas');

    // Patch faceapi cu canvas
    const { Canvas, Image, ImageData } = canvas;
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

    const modelsPath = path.join(__dirname, 'models');
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);

    faceDetector  = faceapi;
    modelsLoaded  = true;
    console.log('✅ Face detector încărcat cu succes');
  } catch (err) {
    console.error('⚠️  Face detector nu s-a putut încărca:', err.message);
    console.log('Serverul continuă fără detecție facială (salvează toate frame-urile)');
  }
}

// ─── DETECȚIE FACIALĂ ────────────────────────────────────────────────────────
async function detectFace(jpegBuffer) {
  if (!modelsLoaded || !faceDetector) {
    // Dacă modelele nu sunt încărcate, returnăm true (salvăm tot)
    return { detected: true, confidence: 1.0, count: 1 };
  }

  try {
    const { createImageData, createCanvas } = require('canvas');
    const img   = await require('canvas').loadImage(jpegBuffer);
    const cnv   = require('canvas').createCanvas(img.width, img.height);
    const ctx   = cnv.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const detections = await faceDetector.detectAllFaces(
      cnv,
      new faceDetector.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })
    );

    if (detections.length > 0) {
      const best = Math.max(...detections.map(d => d.score));
      return { detected: true, confidence: best, count: detections.length };
    }
    return { detected: false, confidence: 0, count: 0 };
  } catch (err) {
    console.error('Eroare detecție:', err.message);
    return { detected: false, confidence: 0, count: 0 };
  }
}

// ─── ENDPOINT: ESP32-CAM trimite frame ──────────────────────────────────────
app.post('/api/upload-frame', requireApiKey, async (req, res) => {
  try {
    const jpegBuffer = req.body;
    if (!jpegBuffer || jpegBuffer.length < 100) {
      return res.status(400).json({ error: 'Frame invalid' });
    }

    console.log(`Frame primit: ${jpegBuffer.length} bytes`);

    const result = await detectFace(jpegBuffer);

    if (result.detected) {
      detectionCount++;
      const entry = {
        id:          detectionCount,
        timestamp:   new Date().toISOString(),
        imageBase64: jpegBuffer.toString('base64'),
        confidence:  parseFloat(result.confidence.toFixed(3)),
        faceCount:   result.count
      };

      faceHistory.unshift(entry);
      if (faceHistory.length > 20) faceHistory = faceHistory.slice(0, 20);

      console.log(`✅ FAȚĂ DETECTATĂ #${entry.id} – confidence: ${entry.confidence}`);
      res.json({ detected: true, id: entry.id, confidence: entry.confidence });
    } else {
      res.json({ detected: false });
    }

  } catch (err) {
    console.error('Eroare upload-frame:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ENDPOINT: Android cere ultima detecție ──────────────────────────────────
app.get('/api/latest-face', requireApiKey, (req, res) => {
  if (faceHistory.length === 0) return res.json({ detected: false });
  const latest = faceHistory[0];
  res.json({
    detected:    true,
    id:          latest.id,
    timestamp:   latest.timestamp,
    imageBase64: latest.imageBase64,
    confidence:  latest.confidence,
    faceCount:   latest.faceCount
  });
});

// ─── ENDPOINT: Istoric (fără imagini) ────────────────────────────────────────
app.get('/api/face-history', requireApiKey, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || 10), 20);
  const items  = faceHistory.slice(0, limit).map(e => ({
    id:         e.id,
    timestamp:  e.timestamp,
    confidence: e.confidence,
    faceCount:  e.faceCount
  }));
  res.json({ count: items.length, items });
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:       'ok',
    uptime:       Math.floor(process.uptime()),
    modelsLoaded: modelsLoaded,
    detections:   detectionCount
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 Server pornit pe portul ${PORT}`);
  await loadFaceDetector();
});