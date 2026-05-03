/**
 * download-models.js
 * Descarcă modelele TinyFaceDetector necesare pentru detecție.
 * Rulat automat la build (build command în Render).
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const BASE_URL   = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';

const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1'
];

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

function download(filename) {
  return new Promise((resolve, reject) => {
    const dest = path.join(MODELS_DIR, filename);

    if (fs.existsSync(dest)) {
      console.log(`✅ Există deja: ${filename}`);
      return resolve();
    }

    const url  = `${BASE_URL}/${filename}`;
    const file = fs.createWriteStream(dest);
    console.log(`⬇️  Descărcare: ${filename}`);

    https.get(url, resp => {
      if (resp.statusCode === 302 || resp.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        https.get(resp.headers.location, r => {
          r.pipe(fs.createWriteStream(dest));
          r.on('end', resolve);
          r.on('error', reject);
        });
        return;
      }
      resp.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  console.log('Descărcare modele face-api.js...');
  for (const f of MODEL_FILES) {
    await download(f);
  }
  console.log('✅ Toate modelele descărcate în ./models/');
}

main().catch(err => {
  console.error('Eroare descărcare modele:', err.message);
  process.exit(1);
});