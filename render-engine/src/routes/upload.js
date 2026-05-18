import { Router } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { createJob, getAllJobs, updateJob } from '../store/jobStore.js';
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
// Multipart form fields: "file" (tek) veya "files" (çoklu)
router.post('/', upload.any(), (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];

  const hasActiveJob = getAllJobs().some((j) => ['queued', 'extracting', 'processing'].includes(j.status));
  if (hasActiveJob) {
    return res.status(429).json({
      error: 'Sistemde aktif bir render işi var. Lütfen mevcut işlem tamamlandıktan sonra tekrar deneyin.',
    });
  }

  if (!files.length) {
    return res.status(400).json({ error: 'Dosya yüklenmedi' });
  }

  const hasVideo = files.some((f) => f.mimetype.startsWith('video/'));
  const hasImage = files.some((f) => f.mimetype.startsWith('image/'));

  if (hasVideo && hasImage) {
    return res.status(400).json({ error: 'Video ve fotoğrafları aynı anda yükleyemezsiniz. Tek tip dosya seçin.' });
  }

  if (hasVideo && files.length > 1) {
    return res.status(400).json({ error: 'Video yüklemede tek dosya desteklenir.' });
  }

  if (hasImage && files.length < 2) {
    return res.status(400).json({
      error: 'Tek fotoğrafla 3D model üretimi güvenilir değildir. Lütfen en az 2-3 farklı açıdan fotoğraf yükleyin.',
    });
  }

  const jobId = uuidv4();
  const firstFile = files[0];
  createJob(jobId, {
    filename: firstFile.filename,
    originalName: firstFile.originalname,
    mimetype: firstFile.mimetype,
    filePath: firstFile.path,
    fileCount: files.length,
    inputType: hasVideo ? 'video' : 'images',
  });

  // Pipeline'ı asenkron başlat
  runPipeline(jobId, files).catch(async (err) => {
    console.error(`[job:${jobId}] Pipeline hatası:`, err.message);

    // If training/export completed but upload to filesystem failed, recover from local PLY.
    const recovered = await tryRecoverResultFromLocalPly(jobId);
    if (recovered) {
      updateJob(jobId, {
        status: 'done',
        progress: 100,
        result: recovered,
      });
      console.log(`[job:${jobId}] Local PLY recovery başarılı`);
      return;
    }

    updateJob(jobId, { status: 'failed', error: humanizePipelineError(err.message) });
  });

  res.status(202).json({
    jobId,
    status: 'queued',
    fileCount: files.length,
    statusUrl: `/api/jobs/${jobId}`,
  });
});

async function runPipeline(jobId, files) {
  const isVideo = files[0].mimetype.startsWith('video/');
  const framesDir = path.join(config.framesDir, jobId);
  const initialFps = 2;

  updateJob(jobId, { status: 'extracting', progress: 5 });

  let frameCount;
  if (isVideo) {
    const file = files[0];
    // Varsayılanı 2fps tutuyoruz: bulanık/sabit videolarda COLMAP daha stabil eşleşiyor.
    const frames = await extractFrames(file.path, framesDir, initialFps);
    frameCount = frames.length;
    console.log(`[job:${jobId}] ${frameCount} frame çıkarıldı`);
  } else {
    // Çoklu fotoğraf setini frame klasörüne kopyala (frame_0001.ext ...)
    await fs.mkdir(framesDir, { recursive: true });
    for (let i = 0; i < files.length; i += 1) {
      const src = files[i].path;
      const ext = path.extname(files[i].originalname).toLowerCase() || '.jpg';
      const outName = `frame_${String(i + 1).padStart(4, '0')}${ext}`;
      await fs.copyFile(src, path.join(framesDir, outName));
    }
    frameCount = files.length;
    console.log(`[job:${jobId}] ${frameCount} fotoğraf frame olarak hazırlandı`);
  }

  updateJob(jobId, { status: 'processing', progress: 10, frameCount });

  const result = await processFramesToSplat(framesDir, jobId, (pct) => {
    updateJob(jobId, { progress: 10 + Math.round(pct * 0.88) });
  }, {
    filePath: files[0].path,
    mimetype: files[0].mimetype,
    initialFps,
    inputType: isVideo ? 'video' : 'images',
  });

  updateJob(jobId, { status: 'done', progress: 100, result });
  console.log(`[job:${jobId}] Tamamlandı`);
}

function humanizePipelineError(rawMessage) {
  const msg = String(rawMessage || '').trim();
  if (!msg) return 'İşlem başarısız oldu.';

  if (msg.includes('COLMAP yeterli kamera pozu çıkaramadı')) {
    return '3D çıkarımı için yeterli kamera pozu bulunamadı. Fotoğraflar arasında daha fazla açı ve örtüşme olacak şekilde yeniden yükleyin; video ise daha yavaş hareketle, daha iyi ışıkta ve sahnenin etrafında dolaşarak tekrar çekin.';
  }

  if (msg.toLowerCase().includes('filesystem')) {
    return 'Model üretildi ancak dosya servisine yüklenemedi. Lütfen kısa süre sonra tekrar deneyin.';
  }

  return msg;
}

async function tryRecoverResultFromLocalPly(jobId) {
  try {
    const plyJobDir = path.join(config.uploadsDir, 'output', jobId);
    const files = await fs.readdir(plyJobDir);
    const plyFile = files.find((f) => f.toLowerCase().endsWith('.ply'));
    if (!plyFile) return null;

    const plyPath = path.join(plyJobDir, plyFile);
    const plyBuffer = await fs.readFile(plyPath);

    const formData = new FormData();
    const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
    formData.append('file', blob, `${jobId}.ply`);

    const fsRes = await fetch(`${config.filesystemUrl}/api/files`, {
      method: 'POST',
      body: formData,
    });

    if (!fsRes.ok) {
      return {
        processor: config.processor,
        jobId,
        splatPath: plyPath,
        message: 'Model üretildi ancak viewer yüklemesi başarısız oldu',
      };
    }

    const fsData = await fsRes.json();
    return {
      processor: config.processor,
      jobId,
      splatPath: plyPath,
      viewerUrl: fsData.viewerUrl,
      downloadUrl: fsData.downloadUrl,
      fileId: fsData.fileId,
      message: 'Sonuç local PLY dosyasından kurtarıldı',
    };
  } catch {
    return null;
  }
}

export default router;
