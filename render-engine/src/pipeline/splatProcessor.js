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
// Yerel COLMAP + nerfstudio splatfacto processor
// Gereksinimler: COLMAP (colmap.exe), nerfstudio conda ortamı
// CUDA GPU gerekli (RTX 4070 Laptop GPU ✓)
// -------------------------------------------------------------------
async function colmapProcessor(framesDir, jobId, onProgress) {
  const { spawn } = await import('child_process');
  const fsAsync = (await import('fs')).promises;

  const nsDataDir  = path.join(config.uploadsDir, 'nsdata',     jobId);
  const nsTrainDir = path.join(config.uploadsDir, 'nstraining', jobId);
  const outputDir  = path.join(config.uploadsDir, 'output');

  await fsAsync.mkdir(nsDataDir,  { recursive: true });
  await fsAsync.mkdir(nsTrainDir, { recursive: true });
  await fsAsync.mkdir(outputDir,  { recursive: true });

  // ns-process-data / ns-train / ns-export için genişletilmiş PATH
  // FFmpeg ve COLMAP'ın nerfstudio Python sürecinden görünmesi için gerekli
  const FFMPEG_BIN = path.dirname(
    'C:\\Users\\ozgen\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe'
  );
  const COLMAP_BIN = path.dirname(config.colmapExe);
  const MSVC_BIN = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64';
  const WINDOWS_SDK_ROOT = 'C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0';
  const WINDOWS_SDK_LIB = 'C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.22621.0';
  const childEnv = {
    ...process.env,
    PATH: `${FFMPEG_BIN};${COLMAP_BIN};${MSVC_BIN};${process.env.PATH || ''}`,
    INCLUDE: [
      `${WINDOWS_SDK_ROOT}\\ucrt`,
      `${WINDOWS_SDK_ROOT}\\um`,
      `${WINDOWS_SDK_ROOT}\\shared`,
      `${WINDOWS_SDK_ROOT}\\winrt`,
      `${WINDOWS_SDK_ROOT}\\cppwinrt`,
      process.env.INCLUDE || '',
    ].filter(Boolean).join(';'),
    LIB: [
      `${WINDOWS_SDK_LIB}\\ucrt\\x64`,
      `${WINDOWS_SDK_LIB}\\um\\x64`,
      process.env.LIB || '',
    ].filter(Boolean).join(';'),
  };

  // Komut çalıştırıcı — stdout/stderr loglar, 0 olmayan çıkışta hata fırlatır
  function runCommand(exe, args, label) {
    return new Promise((resolve, reject) => {
      console.log(`[${label}] ${path.basename(exe)} ${args.slice(0, 4).join(' ')} ...`);
      const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
      proc.stdout.on('data', d => process.stdout.write(`[${label}] ${d}`));
      proc.stderr.on('data', d => process.stderr.write(`[${label}] ${d}`));
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`${label} exit code: ${code}`));
      });
      proc.on('error', reject);
    });
  }

  // Klasördeki en yeni config.yml'yi bulur
  async function findNewestConfig(dir) {
    const walk = async (d) => {
      const entries = await fsAsync.readdir(d, { withFileTypes: true });
      const files = [];
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) files.push(...(await walk(full)));
        else if (e.name === 'config.yml') files.push(full);
      }
      return files;
    };
    const configs = await walk(dir);
    if (configs.length === 0) throw new Error('nerfstudio config.yml bulunamadı');
    // En yeni olanı döndür
    const stats = await Promise.all(configs.map(f => fsAsync.stat(f).then(s => ({ f, t: s.mtimeMs }))));
    return stats.sort((a, b) => b.t - a.t)[0].f;
  }

  // 1. ns-process-data: framelerden COLMAP sparse reconstruction
  onProgress(10);
  console.log(`[job:${jobId}] ns-process-data başlatılıyor...`);
  await runCommand(config.nsProcessData, [
    'images',
    '--data',        framesDir,
    '--output-dir',  nsDataDir,
    '--colmap-cmd',  config.colmapExe,
    '--verbose',
  ], `ns-proc:${jobId.slice(0, 6)}`);
  onProgress(30);

  // 2. ns-train splatfacto: 3DGS eğitimi (~10-30 dk, VRAM'a göre değişir)
  console.log(`[job:${jobId}] ns-train splatfacto başlatılıyor (~10-30 dk)...`);
  await runCommand(config.nsTrain, [
    'splatfacto',
    '--data',                            nsDataDir,
    '--output-dir',                      nsTrainDir,
    '--max-num-iterations',              '7000',   // 4GB VRAM için optimize
    '--pipeline.model.sh-degree',        '0',      // VRAM tasarrufu
    '--pipeline.model.cull-alpha-thresh','0.005',
    '--vis',                             'tensorboard',
  ], `ns-train:${jobId.slice(0, 6)}`);
  onProgress(82);

  // 3. Config dosyasını bul
  const configPath = await findNewestConfig(nsTrainDir);
  console.log(`[job:${jobId}] Config: ${configPath}`);

  // 4. ns-export: .ply dosyasını dışa aktar
  const plyJobDir = path.join(outputDir, jobId);
  await fsAsync.mkdir(plyJobDir, { recursive: true });
  console.log(`[job:${jobId}] ns-export gaussian-splat başlatılıyor...`);
  await runCommand(config.nsExport, [
    'gaussian-splat',
    '--load-config', configPath,
    '--output-dir',  plyJobDir,
  ], `ns-exp:${jobId.slice(0, 6)}`);
  onProgress(90);

  // 5. Üretilen .ply dosyasını bul
  const plyFiles = (await fsAsync.readdir(plyJobDir)).filter(f => f.endsWith('.ply'));
  if (plyFiles.length === 0) throw new Error('ns-export .ply üretmedi');
  const plyPath = path.join(plyJobDir, plyFiles[0]);
  console.log(`[job:${jobId}] .ply: ${plyPath}`);

  // 6. Filesystem servisine yükle
  onProgress(93);
  const plyBuffer = fs.readFileSync(plyPath);
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
  console.log(`[job:${jobId}] Tamamlandı. Viewer: ${fsData.viewerUrl}`);
  return {
    processor: 'colmap+nerfstudio',
    splatPath: plyPath,
    viewerUrl: fsData.viewerUrl,
    downloadUrl: fsData.downloadUrl,
    fileId: fsData.fileId,
  };
}
