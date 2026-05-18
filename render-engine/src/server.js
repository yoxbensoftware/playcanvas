import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import config from './config.js';
import uploadRouter from './routes/upload.js';
import jobsRouter from './routes/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Upload klasörlerini oluştur
fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.framesDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'render-engine', processor: config.processor });
});

app.use('/api/upload', uploadRouter);
app.use('/api/jobs', jobsRouter);

// Global hata handler
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Sunucu hatası' });
});

app.listen(config.port, () => {
  console.log(`render-engine → http://localhost:${config.port}`);
  console.log(`Processor     → ${config.processor}`);
  console.log(`Uploads       → ${config.uploadsDir}`);
});
