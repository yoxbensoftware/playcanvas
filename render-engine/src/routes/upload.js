import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { createJob, updateJob } from '../store/jobStore.js';
import { extractFrames } from '../pipeline/frameExtractor.js';
import { processFramesToSplat } from '../pipeline/splatProcessor.js';

const router = Router();

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error(`İzin verilmeyen dosya türü: ${file.mimetype}`), { status: 400 }));
    }
  },
});

// POST /api/upload
// Multipart form field: "file"
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Dosya yüklenmedi' });
  }

  const jobId = uuidv4();
  createJob(jobId, {
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    filePath: req.file.path,
  });

  // Pipeline'ı asenkron başlat
  runPipeline(jobId, req.file).catch((err) => {
    console.error(`[job:${jobId}] Pipeline hatası:`, err.message);
    updateJob(jobId, { status: 'failed', error: err.message });
  });

  res.status(202).json({
    jobId,
    status: 'queued',
    statusUrl: `/api/jobs/${jobId}`,
  });
});

async function runPipeline(jobId, file) {
  const isVideo = file.mimetype.startsWith('video/');
  const framesDir = path.join(config.framesDir, jobId);

  updateJob(jobId, { status: 'extracting', progress: 5 });

  let frameCount;
  if (isVideo) {
    const frames = await extractFrames(file.path, framesDir, 5);
    frameCount = frames.length;
    console.log(`[job:${jobId}] ${frameCount} frame çıkarıldı`);
  } else {
    // Tek fotoğraf — frame olarak kullan
    frameCount = 1;
  }

  updateJob(jobId, { status: 'processing', progress: 10, frameCount });

  const result = await processFramesToSplat(framesDir, jobId, (pct) => {
    updateJob(jobId, { progress: 10 + Math.round(pct * 0.88) });
  }, { filePath: file.path, mimetype: file.mimetype });

  updateJob(jobId, { status: 'done', progress: 100, result });
  console.log(`[job:${jobId}] Tamamlandı`);
}

export default router;
