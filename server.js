/**
 * Smart Home – Camera Server cu detecție facială
 * Pure JavaScript – fără compilare nativă, funcționează pe Render free tier
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app     = express();
const PORT    = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '57271a26c9cf4eeec7fe46a91f2f4c81';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'image/jpeg', limit: '5mb' }));

// ─── STATE ────────────────────────────────────────────────────────────────────
let faceHistory    = [];
let detectionCount = 0;
let faceapi        = null;
let modelsLoaded   = false;
// ─────────────────────────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace('Bearer ', '');
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── INIȚIALIZARE face-api (pure JS, fără canvas nativ) ──────────────────────
async function loadFaceDetector() {
  try {
    // Folosim distribuția node-cpu care nu necesită canvas sau tfjs-node
    const fa = require('@vladmandic/face-api/dist/face-api.node-cpu.js');
    const tf = require('@tensorflow/tfjs-core');
    require('@tensorflow/tfjs-backend-cpu');

    await tf.setBackend('cpu');
    await tf.ready();

    const modelsPath = path.join(__dirname, 'models');
    await fa.nets.tinyFaceDetector.loadFromDisk(modelsPath);

    faceapi     = fa;
    modelsLoaded = true;
    console.log('✅ Face detector încărcat (pure JS CPU backend)');
  } catch (err) {
    console.error('⚠️  Face detector eroare:', err.message);
    console.log('Serverul va salva toate frame-urile fără detecție');
  }
}

// ─── DETECȚIE FACIALĂ ─────────────────────────────────────────────────────────
async function detectFace(jpegBuffer) {
  if (!modelsLoaded || !faceapi) {
    // Fără model: salvează tot (fallback)
    return { detected: true, confidence: 1.0, count: 1 };
  }

  try {
    // Decodăm JPEG cu jpeg-js (pure JS)
    const jpeg      = require('jpeg-js');
    const decoded   = jpeg.decode(jpegBuffer, { useTArray: true });
    const { width, height, data } = decoded;

    // Construim un tensor din pixelii RGBA
    const tf        = require('@tensorflow/tfjs-core');
    // Convertim RGBA → RGB (scoatem canalul alpha)
    const rgbData   = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgbData[j]     = data[i];
      rgbData[j + 1] = data[i + 1];
      rgbData[j + 2] = data[i + 2];
    }

    const tensor = tf.tensor3d(rgbData, [height, width, 3]);

    const detections = await faceapi.detectAllFaces(
      tensor,
      new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5, inputSize: 224 })
    );

    tensor.dispose();

    if (detections.length > 0) {
      const best = Math.max(...detections.map(d => d.score));
      return { detected: true, confidence: parseFloat(best.toFixed(3)), count: detections.length };
    }
    return { detected: false, confidence: 0, count: 0 };

  } catch (err) {
    console.error('Eroare detecție:', err.message);
    return { detected: false, confidence: 0, count: 0 };
  }
}

// ─── ENDPOINT: ESP32-CAM trimite frame ───────────────────────────────────────
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
        confidence:  result.confidence,
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

// ─── ENDPOINT: Android – ultima detecție ─────────────────────────────────────
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

// ─── ENDPOINT: Istoric ────────────────────────────────────────────────────────
app.get('/api/face-history', requireApiKey, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 10), 20);
  const items = faceHistory.slice(0, limit).map(e => ({
    id: e.id, timestamp: e.timestamp,
    confidence: e.confidence, faceCount: e.faceCount
  }));
  res.json({ count: items.length, items });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:       'ok',
    uptime:       Math.floor(process.uptime()),
    modelsLoaded: modelsLoaded,
    detections:   detectionCount
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 Server pornit pe portul ${PORT}`);
  await loadFaceDetector();
});
