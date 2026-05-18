import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import { extractFrames } from './frameExtractor.js';

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
      return await colmapProcessor(framesDir, jobId, onProgress, options);
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
async function colmapProcessor(framesDir, jobId, onProgress, options = {}) {
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
          const fallback = await runWindowsNerfstudioFallback(framesDir, jobId, onProgress, options);
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

async function runWindowsNerfstudioFallback(framesDir, jobId, onProgress, options = {}) {
  const { spawn, spawnSync } = await import('child_process');
  const fsAsync = (await import('fs')).promises;
  const env = buildWindowsNerfstudioEnv();
  const condaRun = resolveCondaRunFromNsTrain();
  const isPhotoInput = String(options.inputType || '').toLowerCase() === 'images';

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

  const getImageFrameFiles = async (dir) => {
    const entries = await fsAsync.readdir(dir).catch(() => []);
    return entries
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .sort((a, b) => a.localeCompare(b));
  };

  const sampleFramesToDir = async (sourceDir, sourceFiles, targetDir, stride) => {
    await fsAsync.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await fsAsync.mkdir(targetDir, { recursive: true });

    const selected = [];
    for (let i = 0; i < sourceFiles.length; i += stride) {
      selected.push(sourceFiles[i]);
    }

    for (let i = 0; i < selected.length; i += 1) {
      const file = selected[i];
      const src = path.join(sourceDir, file);
      const dst = path.join(targetDir, file);
      await fsAsync.copyFile(src, dst);
    }

    return selected.length;
  };

  const readRegisteredFrameCount = async (nsDataRoot) => {
    const transformsPath = path.join(nsDataRoot, 'transforms.json');
    try {
      const raw = await fsAsync.readFile(transformsPath, 'utf8');
      const json = JSON.parse(raw);
      if (!Array.isArray(json.frames)) return 0;
      return json.frames.length;
    } catch {
      return 0;
    }
  };

  const nsProcessAttempts = isPhotoInput
    ? [
      { name: 'exhaustive-full', matchingMethod: 'exhaustive', stride: 1 },
      { name: 'sequential-full', matchingMethod: 'sequential', stride: 1 },
      { name: 'sequential-stride2', matchingMethod: 'sequential', stride: 2 },
    ]
    : [
      { name: 'exhaustive-full', matchingMethod: 'exhaustive', stride: 1 },
      { name: 'sequential-full', matchingMethod: 'sequential', stride: 1 },
      { name: 'sequential-stride2', matchingMethod: 'sequential', stride: 2 },
      { name: 'sequential-stride3', matchingMethod: 'sequential', stride: 3 },
      { name: 'vocab-stride2', matchingMethod: 'vocab_tree', stride: 2 },
    ];

  const runNsProcessAttempts = async (workingFramesDir, nsDataRoot, tagPrefix) => {
    const sourceFrameFiles = await getImageFrameFiles(workingFramesDir);
    const sourceFrameCount = sourceFrameFiles.length;
    if (sourceFrameCount === 0) {
      throw new Error('Frame bulunamadı: ns-process-data başlatılamadı');
    }

    const goodRegistrationTarget = isPhotoInput
      ? Math.max(6, Math.floor(sourceFrameCount * 0.2))
      : Math.max(24, Math.floor(sourceFrameCount * 0.25));
    const minimumRegistration = isPhotoInput
      ? Math.max(4, Math.floor(sourceFrameCount * 0.08))
      : Math.max(10, Math.floor(sourceFrameCount * 0.1));
    let bestAttempt = null;

    for (const attempt of nsProcessAttempts) {
      const attemptInputDir = attempt.stride === 1
        ? workingFramesDir
        : path.join(nsDataRoot, `sample_${tagPrefix}_${attempt.name}`);

      const inputFrameCount = attempt.stride === 1
        ? sourceFrameCount
        : await sampleFramesToDir(workingFramesDir, sourceFrameFiles, attemptInputDir, attempt.stride);

      const attemptOutDir = path.join(nsDataRoot, `${tagPrefix}_${attempt.name}`);
      await fsAsync.rm(attemptOutDir, { recursive: true, force: true }).catch(() => {});
      await fsAsync.mkdir(attemptOutDir, { recursive: true });

      console.log(
        `[job:${jobId}] ns-process-data denemesi: ${tagPrefix}/${attempt.name} | matching=${attempt.matchingMethod} | stride=${attempt.stride} | frame=${inputFrameCount}`
      );

      try {
        await runExe(config.nsProcessData, [
          'images',
          '--data', attemptInputDir,
          '--output-dir', attemptOutDir,
          '--camera-type', 'perspective',
          '--sfm-tool', 'colmap',
          '--matching-method', attempt.matchingMethod,
          '--num-downscales', isPhotoInput ? '1' : '2',
          '--colmap-cmd', config.colmapExe,
        ], 'ns-proc');

        const registeredFrames = await readRegisteredFrameCount(attemptOutDir);
        const ratio = inputFrameCount > 0 ? registeredFrames / inputFrameCount : 0;
        console.log(
          `[job:${jobId}] ns-process-data sonucu: ${tagPrefix}/${attempt.name} -> ${registeredFrames}/${inputFrameCount} (${(ratio * 100).toFixed(1)}%)`
        );

        const candidate = {
          ...attempt,
          inputFrameCount,
          registeredFrames,
          nsDataDir: attemptOutDir,
          minimumRegistration,
          sourceFrameCount,
        };

        if (!bestAttempt || candidate.registeredFrames > bestAttempt.registeredFrames) {
          bestAttempt = candidate;
        }

        if (registeredFrames >= goodRegistrationTarget) {
          break;
        }
      } catch (err) {
        console.warn(`[job:${jobId}] ns-process-data başarısız (${tagPrefix}/${attempt.name}): ${err.message}`);
      }
    }

    return bestAttempt;
  };

  onProgress(20);
  let bestAttempt = await runNsProcessAttempts(framesDir, nsDataDir, 'orig');

  const shouldRetryWithLowerFps =
    (!bestAttempt || bestAttempt.registeredFrames < bestAttempt.minimumRegistration) &&
    Boolean(options.filePath) &&
    String(options.mimetype || '').startsWith('video/');

  if (shouldRetryWithLowerFps) {
    const initialFps = Number(options.initialFps) || null;
    const retryFpsValues = [2, 1].filter((fps, idx, arr) => fps !== initialFps && arr.indexOf(fps) === idx);

    for (const retryFps of retryFpsValues) {
      const retryFramesDir = path.join(config.framesDir, `${jobId}_retry${retryFps}fps`);
      await fsAsync.rm(retryFramesDir, { recursive: true, force: true }).catch(() => {});

      console.warn(`[job:${jobId}] Poz sayısı düşük, video ${retryFps}fps ile yeniden örnekleniyor ve COLMAP tekrar deneniyor...`);
      const retryFrames = await extractFrames(options.filePath, retryFramesDir, retryFps);
      console.log(`[job:${jobId}] Retry için ${retryFrames.length} frame çıkarıldı (${retryFps}fps)`);

      const retryRoot = path.join(config.uploadsDir, 'nsdata', jobId, `retry_${retryFps}fps`);
      await fsAsync.rm(retryRoot, { recursive: true, force: true }).catch(() => {});
      await fsAsync.mkdir(retryRoot, { recursive: true });

      const retryBest = await runNsProcessAttempts(
        retryFramesDir,
        retryRoot,
        `retry${retryFps}fps`
      );

      if (!bestAttempt || (retryBest && retryBest.registeredFrames > bestAttempt.registeredFrames)) {
        bestAttempt = retryBest;
      }

      if (bestAttempt && bestAttempt.registeredFrames >= bestAttempt.minimumRegistration) {
        break;
      }
    }
  }

  const minimumRegistration = bestAttempt?.minimumRegistration ?? 12;
  if (!bestAttempt || bestAttempt.registeredFrames < minimumRegistration) {
    const registered = bestAttempt?.registeredFrames ?? 0;
    const total = bestAttempt?.inputFrameCount ?? bestAttempt?.sourceFrameCount ?? 0;
    const hint = isPhotoInput
      ? 'Fotoğraflar arasında daha fazla açı ve örtüşme olacak şekilde yeniden yükleyin.'
      : 'Videoyu daha yavaş hareketle, daha iyi ışıkta ve sahnenin etrafında dolaşarak tekrar çekin.';
    throw new Error(
      `COLMAP yeterli kamera pozu çıkaramadı (${registered}/${total}). ${hint}`
    );
  }

  if (bestAttempt.nsDataDir !== nsDataDir) {
    await fsAsync.rm(nsDataDir, { recursive: true, force: true }).catch(() => {});
    await fsAsync.cp(bestAttempt.nsDataDir, nsDataDir, { recursive: true });
  }

  console.log(
    `[job:${jobId}] ns-process-data seçilen sonuç: ${bestAttempt.name} -> ${bestAttempt.registeredFrames}/${bestAttempt.inputFrameCount}`
  );

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


