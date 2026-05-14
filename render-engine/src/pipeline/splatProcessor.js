import fs from 'fs';
import path from 'path';
import config from '../config.js';

/**
 * Frame klasöründeki görüntülerden 3D Gaussian Splat (.ply) üretir.
 *
 * processor değerine göre çalışır:
 *   mock   → geliştirme için sahte akış (GPU gerekmez)
 *   lumaai → Luma AI bulut API
 *   colmap → yerel COLMAP + 3DGS (CUDA GPU + Linux/WSL gerekli)
 *
 * @param {string}   framesDir         - Frame görüntülerinin bulunduğu klasör
 * @param {string}   jobId             - İşin benzersiz ID'si
 * @param {Function} onProgress        - (0-100) arasında ilerleme callback'i
 * @param {object}   [options]         - Ek seçenekler
 * @param {string}   [options.filePath] - Orijinal video/fotoğraf dosya yolu
 * @param {string}   [options.mimetype] - Dosya MIME türü
 * @returns {Promise<{splatPath?: string, viewerUrl?: string, message?: string}>}
 */
export async function processFramesToSplat(framesDir, jobId, onProgress, options = {}) {
  switch (config.processor) {
    case 'mock':
      return await mockProcessor(jobId, onProgress);
    case 'lumaai':
      return await lumaAiProcessor(framesDir, jobId, onProgress, options);
    case 'colmap':
      return await colmapProcessor(framesDir, jobId, onProgress);
    default:
      throw new Error(`Bilinmeyen processor: ${config.processor}`);
  }
}

// -------------------------------------------------------------------
// Mock processor — gerçek 3DGS olmadan end-to-end akışı test eder
// -------------------------------------------------------------------
async function mockProcessor(jobId, onProgress) {
  const steps = [20, 40, 60, 80, 100];
  for (const pct of steps) {
    await new Promise((r) => setTimeout(r, 800));
    onProgress(pct);
  }
  return {
    processor: 'mock',
    message: 'Mock tamamlandı. Gerçek pipeline için PROCESSOR=colmap veya lumaai yap.',
  };
}

// -------------------------------------------------------------------
// Luma AI processor
// API: https://webapp.engineeringlumalabs.com/api/v2/captures
// -------------------------------------------------------------------
const LUMA_API = 'https://webapp.engineeringlumalabs.com/api/v2';

async function lumaAiProcessor(framesDir, jobId, onProgress, options = {}) {
  if (!config.lumaApiKey) {
    throw new Error('Luma AI için LUMA_API_KEY .env dosyasında tanımlı olmalı.');
  }

  const { filePath, mimetype } = options;
  if (!filePath) throw new Error('Luma AI processor için orijinal dosya yolu (filePath) gerekli.');

  const authHeaders = {
    Authorization: `luma-api-key=${config.lumaApiKey}`,
    'Content-Type': 'application/json',
  };

  // 1. Capture oluştur
  onProgress(5);
  console.log(`[luma:${jobId}] Capture oluşturuluyor...`);
  const createRes = await fetch(`${LUMA_API}/captures`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title: `evimigez-${jobId}` }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Luma AI capture oluşturulamadı: ${createRes.status} — ${errText}`);
  }
  const capture = await createRes.json();
  const captureId = capture.id;
  const signedVideoUrl = capture.signedUrls?.video;
  if (!signedVideoUrl) throw new Error('Luma AI signed upload URL alınamadı');

  // 2. Videoyu Luma AI'ya yükle
  onProgress(15);
  console.log(`[luma:${jobId}] Video yükleniyor (captureId: ${captureId})...`);
  const videoBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(signedVideoUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype || 'video/mp4' },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`Video yüklenemedi: ${uploadRes.status}`);

  // 3. İşlemi tetikle
  onProgress(20);
  console.log(`[luma:${jobId}] İşlem tetikleniyor...`);
  const triggerRes = await fetch(`${LUMA_API}/captures/${captureId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ triggerCapture: true }),
  });
  if (!triggerRes.ok) throw new Error(`İşlem başlatılamadı: ${triggerRes.status}`);

  // 4. Tamamlanana kadar poll et (8s aralıkla)
  console.log(`[luma:${jobId}] İşleniyor, bekleniyor...`);
  let progress = 20;
  while (true) {
    await new Promise((r) => setTimeout(r, 8000));
    const statusRes = await fetch(`${LUMA_API}/captures/${captureId}`, {
      headers: { Authorization: `luma-api-key=${config.lumaApiKey}` },
    });
    const status = await statusRes.json();
    console.log(`[luma:${jobId}] Durum: ${status.status}`);

    if (status.status === 'failed') {
      throw new Error(`Luma AI işlemi başarısız: ${status.errorMessage || 'bilinmeyen hata'}`);
    }

    if (status.status === 'complete') {
      const artifactUrl = status.artifact?.url;
      if (!artifactUrl) throw new Error('Luma AI artifact URL bulunamadı');

      // 5. .ply dosyasını indir
      onProgress(85);
      console.log(`[luma:${jobId}] Artifact indiriliyor...`);
      const plyRes = await fetch(artifactUrl);
      if (!plyRes.ok) throw new Error(`Artifact indirilemedi: ${plyRes.status}`);
      const plyBuffer = Buffer.from(await plyRes.arrayBuffer());

      const outputDir = path.join(config.uploadsDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });
      const plyPath = path.join(outputDir, `${jobId}.ply`);
      fs.writeFileSync(plyPath, plyBuffer);
      console.log(`[luma:${jobId}] .ply kaydedildi: ${plyPath}`);

      // 6. Filesystem servisine yükle
      onProgress(92);
      const formData = new FormData();
      const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
      formData.append('file', blob, `${jobId}.ply`);

      const fsRes = await fetch(`${config.filesystemUrl}/api/files`, {
        method: 'POST',
        body: formData,
      });
      if (!fsRes.ok) throw new Error(`Filesystem yükleme hatası: ${fsRes.status}`);
      const fsData = await fsRes.json();

      onProgress(100);
      console.log(`[luma:${jobId}] Tamamlandı. Viewer: ${fsData.viewerUrl}`);
      return {
        processor: 'lumaai',
        captureId,
        splatPath: plyPath,
        viewerUrl: fsData.viewerUrl,
        downloadUrl: fsData.downloadUrl,
        fileId: fsData.fileId,
      };
    }

    progress = Math.min(progress + 4, 82);
    onProgress(progress);
  }
}

// -------------------------------------------------------------------
// Yerel COLMAP + 3DGS processor
// Gereksinimler: NVIDIA CUDA GPU, COLMAP, gaussian-splatting repo
// Windows için WSL2 veya Docker önerilir
// -------------------------------------------------------------------
async function colmapProcessor(framesDir, jobId, onProgress) {
  // TODO: Yerel pipeline
  // 1. COLMAP ile Structure from Motion (kamera pozisyonları)
  //    spawn('colmap', ['automatic_reconstructor', ...])
  // 2. 3DGS training
  //    spawn('python', ['train.py', '--source_path', framesDir, ...])
  // 3. Output .ply dosyasını splat-transform ile optimize et
  throw new Error(
    'COLMAP processor henüz implemente edilmedi. GPU sunucusu hazır olduğunda aktive edilecek.'
  );
}
