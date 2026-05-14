import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import config from './config.js';
import filesRouter from './routes/files.js';
import viewerRouter from './routes/viewer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Data klasörünü oluştur
fs.mkdirSync(config.dataDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// supersplat-viewer'ın build çıktısını /viewer altında serve et
// Önce build et: cd ../supersplat-viewer && npm install && npm run build
if (fs.existsSync(config.viewerDist)) {
  app.use('/viewer', express.static(config.viewerDist));
  console.log(`supersplat-viewer → /viewer (${config.viewerDist})`);
} else {
  console.warn(
    `[uyarı] supersplat-viewer dist bulunamadı: ${config.viewerDist}\n` +
    `        Çalıştır: cd ../supersplat-viewer && npm install && npm run build`
  );
  app.get('/viewer*', (_req, res) =>
    res.status(503).send('supersplat-viewer henüz build edilmedi. README\'e bak.')
  );
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'filesystem' });
});

app.use('/api/files', filesRouter);
app.use('/view', viewerRouter);

// Global hata handler
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Sunucu hatası' });
});

app.listen(config.port, () => {
  console.log(`filesystem → http://localhost:${config.port}`);
  console.log(`Data       → ${config.dataDir}`);
  console.log(`Viewer     → http://localhost:${config.port}/viewer/`);
});
