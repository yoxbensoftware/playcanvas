import config from '../config.js';

/**
 * Frame klasöründeki görüntülerden 3D Gaussian Splat (.ply) üretir.
 *
 * processor değerine göre çalışır:
 *   mock   → geliştirme için sahte akış (GPU gerekmez)
 *   lumaai → Luma AI bulut API
 *   colmap → yerel COLMAP + 3DGS (CUDA GPU + Linux/WSL gerekli)
 *
 * @param {string}   framesDir  - Frame görüntülerinin bulunduğu klasör
 * @param {string}   jobId      - İşin benzersiz ID'si
 * @param {Function} onProgress - (0-100) arasında ilerleme callback'i
 * @returns {Promise<{splatPath?: string, message?: string}>}
 */
export async function processFramesToSplat(framesDir, jobId, onProgress) {
  switch (config.processor) {
    case 'mock':
      return await mockProcessor(jobId, onProgress);
    case 'lumaai':
      return await lumaAiProcessor(framesDir, jobId, onProgress);
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
// Döküman: https://lumalabs.ai/dream-machine/api/docs
// -------------------------------------------------------------------
async function lumaAiProcessor(framesDir, jobId, onProgress) {
  if (!config.lumaApiKey) {
    throw new Error('Luma AI için LUMA_API_KEY .env dosyasında tanımlı olmalı.');
  }

  // TODO: Luma AI API entegrasyonu
  // 1. framesDir içindeki görüntüleri zip'le veya video URL'si gönder
  // 2. POST https://api.lumalabs.ai/dream-machine/v1/generations
  // 3. İşi poll ederek tamamlanmasını bekle
  // 4. .ply dosyasını indir, output klasörüne kaydet
  throw new Error('Luma AI processor henüz implemente edilmedi.');
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
