import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// WSL-based COLMAP + nerfstudio splatfacto processor
// Linux Ubuntu içinde nerfstudio çalışır, Windows render-engine orchestrates
// Gereksinimler: WSL 2 + Ubuntu + GPU passthrough
// CUDA GPU gerekli (RTX 4070 Laptop GPU ✓ via nvidia-smi)
// -------------------------------------------------------------------
async function colmapProcessor(framesDir, jobId, onProgress) {
  const { spawn } = await import('child_process');
  const fsAsync = (await import('fs')).promises;

  const toWslPath = (p) => p
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/i, (_, d) => `/mnt/${d.toLowerCase()}`);

  const outputDir = path.join(config.uploadsDir, 'output');
  await fsAsync.mkdir(outputDir, { recursive: true });

  // WSL script yolu
  const wslScriptPath = path.join(__dirname, '..', '..', 'tools', 'wsl-nerfstudio-train.sh');
  const wslScriptPathWsl = toWslPath(wslScriptPath);
  
  // Windows PATH -> WSL PATH dönüşümü
  const wslFramesDir = toWslPath(framesDir);

  const wslOutputDir = toWslPath(outputDir);

  console.log(`[job:${jobId}] WSL nerfstudio eğitimi başlatılıyor...`);
  console.log(`[job:${jobId}]   Script (win): ${wslScriptPath}`);
  console.log(`[job:${jobId}]   Script (wsl): ${wslScriptPathWsl}`);
  console.log(`[job:${jobId}]   Frames (WSL): ${wslFramesDir}`);
  console.log(`[job:${jobId}]   Output (WSL): ${wslOutputDir}`);
  onProgress(5);

  return new Promise((resolve, reject) => {
    // WSL process çalıştır
    const proc = spawn('wsl', [
      '-d', 'Ubuntu',
      '-e', 'bash',
      wslScriptPathWsl,
      wslFramesDir,
      jobId,
      wslOutputDir,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastOutput = '';
    let progressEstimate = 5;

    proc.stdout.on('data', (data) => {
      const msg = data.toString();
      lastOutput += msg;
      process.stdout.write(`[wsl:${jobId.slice(0, 6)}] ${msg}`);

      // Parse progress hints from script
      if (msg.includes('ns-process-data')) {
        progressEstimate = Math.max(progressEstimate, 20);
        onProgress(20);
      } else if (msg.includes('Running ns-train')) {
        progressEstimate = Math.max(progressEstimate, 35);
        onProgress(35);
      } else if (msg.includes('Running ns-export')) {
        progressEstimate = Math.max(progressEstimate, 85);
        onProgress(85);
      } else if (msg.includes('SUCCESS') || msg.includes('PLY exported')) {
        onProgress(100);
      }
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(`[wsl:${jobId.slice(0, 6)}] ${data}`);
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        // Script başarılı; .ply dosyasını bul
        try {
          const plyJobDir = path.join(outputDir, jobId);
          const plyFiles = (await fsAsync.readdir(plyJobDir)).filter(f => f.endsWith('.ply'));
          
          if (plyFiles.length === 0) {
            throw new Error('WSL script .ply dosyası üretmedi');
          }

          const plyPath = path.join(plyJobDir, plyFiles[0]);
          console.log(`[job:${jobId}] .ply başarıyla oluşturuldu: ${plyPath}`);
          onProgress(95);

          // Filesystem servisine yükle
          try {
            const plyBuffer = await fsAsync.readFile(plyPath);
            const formData = new FormData();
            const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
            formData.append('file', blob, `${jobId}.ply`);

            const fsRes = await fetch(`${config.filesystemUrl}/api/files`, {
              method: 'POST',
              body: formData,
            });

            if (!fsRes.ok) {
              console.warn(`[job:${jobId}] Filesystem yükleme başarısız: ${fsRes.status}`);
              resolve({
                processor: 'colmap',
                jobId,
                splatPath: plyPath,
                message: 'Eğitim tamamlandı, fakat viewer yüklemesi yapılamadı',
              });
              return;
            }

            const fsData = await fsRes.json();
            onProgress(100);
            console.log(`[job:${jobId}] Viewer: ${fsData.viewerUrl}`);

            resolve({
              processor: 'colmap',
              jobId,
              splatPath: plyPath,
              viewerUrl: fsData.viewerUrl,
              downloadUrl: fsData.downloadUrl,
              fileId: fsData.fileId,
            });
          } catch (uploadErr) {
            console.warn(`[job:${jobId}] Filesystem yükleme hatası: ${uploadErr.message}`);
            resolve({
              processor: 'colmap',
              jobId,
              splatPath: plyPath,
              message: 'Eğitim tamamlandı, fakat viewer yüklemesi başarısız',
            });
          }
        } catch (err) {
          reject(err);
        }
      } else {
        console.warn(`[job:${jobId}] WSL başarısız (exit code: ${code}), Windows fallback deneniyor...`);
        if (lastOutput.trim()) {
          const tail = lastOutput.trim().split(/\r?\n/).slice(-8).join('\n');
          console.warn(`[job:${jobId}] WSL son loglar:\n${tail}`);
        }

        try {
          const fallback = await runWindowsNerfstudioFallback(framesDir, jobId, onProgress);
          resolve(fallback);
        } catch (fallbackErr) {
          reject(new Error(
            `WSL nerfstudio eğitimi başarısız (exit code: ${code}); Windows fallback da başarısız: ${fallbackErr.message}`
          ));
        }
      }
    });

    proc.on('error', reject);
  });
}

async function runWindowsNerfstudioFallback(framesDir, jobId, onProgress) {
  const { spawn, spawnSync } = await import('child_process');
  const fsAsync = (await import('fs')).promises;
  const env = buildWindowsNerfstudioEnv();
  const condaRun = resolveCondaRunFromNsTrain();

  const nsDataDir = path.join(config.uploadsDir, 'nsdata', jobId);
  const nsTrainDir = path.join(config.uploadsDir, 'nstraining', jobId);
  const outputDir = path.join(config.uploadsDir, 'output', jobId);

  await fsAsync.mkdir(nsDataDir, { recursive: true });
  await fsAsync.mkdir(nsTrainDir, { recursive: true });
  await fsAsync.mkdir(outputDir, { recursive: true });

  const hasClCompiler = spawnSync('where', ['cl'], {
    stdio: 'ignore',
    env,
    shell: true,
  }).status === 0;

  const trainMethod = hasClCompiler ? 'splatfacto' : 'nerfacto';
  const trainIterations = trainMethod === 'splatfacto'
    ? Math.max(500, config.nsTrainIterationsSplat || 3000)
    : Math.max(500, config.nsTrainIterationsNerfacto || 1200);

  if (!hasClCompiler) {
    console.warn(`[job:${jobId}] MSVC cl.exe bulunamadı, fallback modeli nerfacto olarak değiştirildi.`);
  }

  const trainProgressFromPercent = (percentValue) => {
    const clamped = Math.max(0, Math.min(100, percentValue));
    // Map training progress to 35..84; upload route maps this into overall 10..97.
    const mapped = 35 + Math.round(clamped * 0.49);
    onProgress(Math.max(35, Math.min(84, mapped)));
  };

  const parseTrainProgress = (line) => {
    const m = line.match(/\((\d+(?:\.\d+)?)%\)/);
    if (!m) return;
    const pct = Number(m[1]);
    if (Number.isFinite(pct)) {
      trainProgressFromPercent(pct);
    }
  };

  const runExe = (exe, args, tag, options = {}) => new Promise((resolve, reject) => {
    const { onStdoutLine } = options;
    const useCondaRun = tag === 'ns-train' && Boolean(condaRun?.condaExe && condaRun?.envName);
    const cmd = useCondaRun ? condaRun.condaExe : exe;
    const cmdArgs = useCondaRun
      ? ['run', '--no-capture-output', '-n', condaRun.envName, exe, ...args]
      : args;

    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(`[${tag}:${jobId.slice(0, 6)}] ${s}`);

      if (onStdoutLine) {
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim()) onStdoutLine(line);
        }
      }
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[${tag}:${jobId.slice(0, 6)}] ${s}`);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${tag} exit code ${code}`));
    });
  });

  onProgress(20);
  // Frame sayısına göre matching method seç:
  // < 600 frame: exhaustive (tüm çiftleri karşılaştırır, loop closure mükemmel)
  // >= 600 frame: vocab_tree (daha hızlı, büyük veri setleri için)
  const frameFiles = await fsAsync.readdir(framesDir).catch(() => []);
  const frameCount2 = frameFiles.filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;
  const matchingMethod = frameCount2 < 600 ? 'exhaustive' : 'vocab_tree';
  console.log(`[job:${jobId}] ${frameCount2} frame tespit edildi → matching: ${matchingMethod}`);

  await runExe(config.nsProcessData, [
    'images',
    '--data', framesDir,
    '--output-dir', nsDataDir,
    '--camera-type', 'perspective',
    '--sfm-tool', 'colmap',
    '--matching-method', matchingMethod,
    '--num-downscales', '3',
    '--colmap-cmd', config.colmapExe,
  ], 'ns-proc');

  onProgress(35);
  if (trainMethod === 'splatfacto') {
    await runExe(config.nsTrain, [
      'splatfacto',
      '--data', nsDataDir,
      '--output-dir', nsTrainDir,
      '--max-num-iterations', String(trainIterations),
      '--pipeline.model.sh-degree', '0',
      '--pipeline.model.cull-alpha-thresh', '0.005',
      '--vis', 'tensorboard',
    ], 'ns-train', { onStdoutLine: parseTrainProgress });
  } else {
    await runExe(config.nsTrain, [
      'nerfacto',
      '--data', nsDataDir,
      '--output-dir', nsTrainDir,
      '--max-num-iterations', String(trainIterations),
      '--pipeline.model.near-plane', '0.05',
      '--pipeline.model.far-plane', '100.0',
      '--vis', 'tensorboard',
    ], 'ns-train', { onStdoutLine: parseTrainProgress });
  }

  const configPath = await findLatestFileByName(nsTrainDir, 'config.yml');
  if (!configPath) {
    throw new Error('Fallback için config.yml bulunamadı');
  }

  onProgress(85);
  if (trainMethod === 'splatfacto') {
    await runExe(config.nsExport, [
      'gaussian-splat',
      '--load-config', configPath,
      '--output-dir', outputDir,
    ], 'ns-exp');
  } else {
    await runExe(config.nsExport, [
      'pointcloud',
      '--load-config', configPath,
      '--output-dir', outputDir,
      '--num-points', String(Math.max(100000, config.nsExportNumPoints || 350000)),
      '--remove-outliers', 'True',
      '--normal-method', 'open3d',
    ], 'ns-exp');
  }

  const files = await fsAsync.readdir(outputDir);
  const plyFile = files.find((f) => f.toLowerCase().endsWith('.ply'));
  if (!plyFile) {
    throw new Error('Fallback export sonunda .ply bulunamadı');
  }

  const plyPath = path.join(outputDir, plyFile);
  onProgress(95);

  try {
    const plyBuffer = await fsAsync.readFile(plyPath);
    const formData = new FormData();
    const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
    formData.append('file', blob, `${jobId}.ply`);

    const fsRes = await fetch(`${config.filesystemUrl}/api/files`, {
      method: 'POST',
      body: formData,
    });

    if (!fsRes.ok) {
      return {
        processor: 'colmap-windows-fallback',
        jobId,
        splatPath: plyPath,
        message: 'Windows fallback tamamlandı, fakat viewer yüklemesi yapılamadı',
      };
    }

    const fsData = await fsRes.json();
    onProgress(100);
    return {
      processor: 'colmap-windows-fallback',
      jobId,
      splatPath: plyPath,
      viewerUrl: fsData.viewerUrl,
      downloadUrl: fsData.downloadUrl,
      fileId: fsData.fileId,
    };
  } catch {
    return {
      processor: 'colmap-windows-fallback',
      jobId,
      splatPath: plyPath,
      message: 'Windows fallback tamamlandı, fakat viewer yüklemesi başarısız',
    };
  }
}

function buildWindowsNerfstudioEnv() {
  const env = { ...process.env };
  const cudaPath = env.CUDA_PATH || env.CUDA_HOME || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4';
  const ffmpegBin = resolveFfmpegBinDir();

  env.CUDA_PATH = cudaPath;
  env.CUDA_HOME = cudaPath;

  const nsExeDir = path.dirname(config.nsTrain || '');
  const nsEnvDir = path.dirname(nsExeDir || '');
  const condaLibraryBin = nsEnvDir ? path.join(nsEnvDir, 'Library', 'bin') : '';
  const condaScripts = nsEnvDir ? path.join(nsEnvDir, 'Scripts') : '';
  const cudaBin = path.join(cudaPath, 'bin');

  const prepend = [ffmpegBin, cudaBin, condaLibraryBin, condaScripts, nsExeDir]
    .filter(Boolean)
    .join(';');

  const winSystem = [
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
  ].join(';');

  const existingPath = env.PATH || '';
  env.PATH = [prepend, winSystem, existingPath].filter(Boolean).join(';');
  if (ffmpegBin) {
    env.FFMPEG_BINARY = path.join(ffmpegBin, 'ffmpeg.exe');
  }
  return env;
}

function resolveFfmpegBinDir() {
  const candidates = [
    'C:\\Users\\ozgen\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'C:\\ffmpeg',
  ];

  for (const base of candidates) {
    try {
      if (!fs.existsSync(base)) continue;

      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const bin = path.join(base, e.name, 'bin');
        const exe = path.join(bin, 'ffmpeg.exe');
        if (fs.existsSync(exe)) return bin;
      }

      const directExe = path.join(base, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(directExe)) return path.join(base, 'bin');
    } catch {
      // Ignore probe failures and continue with next candidate.
    }
  }

  return null;
}

function resolveCondaRunFromNsTrain() {
  const nsTrainPath = config.nsTrain || '';
  const m = nsTrainPath.match(/^(.*)\\envs\\([^\\]+)\\Scripts\\[^\\]+$/i);
  if (!m) return null;

  const condaRoot = m[1];
  const envName = m[2];
  const condaExe = path.join(condaRoot, 'Scripts', 'conda.exe');

  if (!fs.existsSync(condaExe)) return null;
  return { condaExe, envName };
}

async function findLatestFileByName(rootDir, fileName) {
  const fsAsync = (await import('fs')).promises;
  const stack = [rootDir];
  let latest = null;

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsAsync.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name === fileName) {
        const stat = await fsAsync.stat(full);
        if (!latest || stat.mtimeMs > latest.mtimeMs) {
          latest = { path: full, mtimeMs: stat.mtimeMs };
        }
      }
    }
  }

  return latest?.path || null;
}


