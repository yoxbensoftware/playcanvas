import { Router } from 'express';
import multer from 'multer';
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

// POST /api/files
// Multipart field: "file"
// Opsiyonel body: { label: "Kadıköy 3+1 Daire" }
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

  const fileId = uuidv4();
  const shortId = uuidv4().replace(/-/g, '').slice(0, 10);

  saveFile(fileId, {
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    label: req.body?.label || req.file.originalname,
    shortId,
  });

  registerLink(shortId, fileId);

  const viewerUrl = `${config.viewerBaseUrl}/view/${shortId}`;
  const downloadUrl = `${config.viewerBaseUrl}/api/files/${fileId}/raw`;

  console.log(`[filesystem] Dosya kaydedildi: ${fileId} → ${viewerUrl}`);

  res.status(201).json({ fileId, shortId, viewerUrl, downloadUrl });
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
