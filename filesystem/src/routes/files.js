import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { saveFile, getFile, listFiles, registerLink } from '../store/fileStore.js';

const router = Router();

const ALLOWED_EXT = new Set(['.ply', '.splat', '.glb', '.gltf', '.mp4', '.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination: config.dataDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error(`İzin verilmeyen uzantı: ${ext}`), { status: 400 }));
    }
  },
});

function inspectViewerSupport(filePath, ext) {
  const lower = ext.toLowerCase();
  if (lower === '.splat' || lower === '.glb' || lower === '.gltf') {
    return { viewerSupported: true, viewerHint: null };
  }

  if (lower !== '.ply') {
    return { viewerSupported: true, viewerHint: null };
  }

  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(32 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);

    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const looksLikeGaussian =
      /property\s+float\s+scale_0/.test(header) ||
      /property\s+float\s+opacity/.test(header) ||
      /property\s+float\s+f_dc_0/.test(header);

    if (looksLikeGaussian) {
      return { viewerSupported: true, viewerHint: null };
    }

    return {
      viewerSupported: false,
      viewerHint: 'Bu PLY point-cloud formatinda. Supersplat viewer Gaussian-Splat PLY bekliyor.',
    };
  } catch {
    return {
      viewerSupported: false,
      viewerHint: 'Dosya basligi okunamadi. Viewer uyumlulugu dogrulanamadi.',
    };
  }
}

// POST /api/files
// Multipart field: "file"
// Opsiyonel body: { label: "Kadıköy 3+1 Daire" }
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

  const fileId = uuidv4();
  const shortId = uuidv4().replace(/-/g, '').slice(0, 10);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const formatInfo = inspectViewerSupport(req.file.path, ext);

  saveFile(fileId, {
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    label: req.body?.label || req.file.originalname,
    shortId,
    viewerSupported: formatInfo.viewerSupported,
    viewerHint: formatInfo.viewerHint,
  });

  registerLink(shortId, fileId);

  const viewerUrl = `${config.viewerBaseUrl}/view/${shortId}`;
  const downloadUrl = `${config.viewerBaseUrl}/api/files/${fileId}/raw`;

  console.log(`[filesystem] Dosya kaydedildi: ${fileId} → ${viewerUrl}`);

  res.status(201).json({
    fileId,
    shortId,
    viewerUrl,
    downloadUrl,
    viewerSupported: formatInfo.viewerSupported,
    viewerHint: formatInfo.viewerHint,
  });
});

// GET /api/files
router.get('/', (_req, res) => {
  res.json(listFiles());
});

// GET /api/files/:id/raw  — ham dosyayı indir
router.get('/:id/raw', (req, res) => {
  const meta = getFile(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Dosya bulunamadı' });
  const filePath = path.join(config.dataDir, meta.filename);
  res.download(filePath, meta.originalName);
});

export default router;
