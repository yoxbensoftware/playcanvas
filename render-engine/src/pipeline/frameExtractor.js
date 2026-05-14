import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Winget ile kurulan FFmpeg yolunu ayarla (PATH yenilenmesi gerekmez)
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  'C:\\Users\\ozgen\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe',
].filter(Boolean);

const ffmpegBin = FFMPEG_CANDIDATES.find((p) => existsSync(p));
if (ffmpegBin) {
  ffmpeg.setFfmpegPath(ffmpegBin);
  console.log(`[ffmpeg] Yol: ${ffmpegBin}`);
}

/**
 * Video dosyasından frame'leri çıkarır.
 * @param {string} videoPath  - Kaynak video dosya yolu
 * @param {string} outputDir  - Frame'lerin yazılacağı klasör
 * @param {number} fps        - Saniyede çıkarılacak frame sayısı (varsayılan 2)
 * @returns {Promise<string[]>} - Çıkarılan frame dosya yolları
 */
export async function extractFrames(videoPath, outputDir, fps = 2) {
  await fs.mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([`-vf fps=${fps}`, '-q:v 2'])
      .output(path.join(outputDir, 'frame_%04d.jpg'))
      .on('start', (cmd) => console.log(`[ffmpeg] ${cmd}`))
      .on('end', async () => {
        const files = await fs.readdir(outputDir);
        const frames = files
          .filter((f) => f.endsWith('.jpg'))
          .map((f) => path.join(outputDir, f))
          .sort();
        console.log(`[ffmpeg] ${frames.length} frame çıkarıldı → ${outputDir}`);
        resolve(frames);
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg hatası: ${err.message}. FFmpeg kurulu olduğundan emin ol.`));
      })
      .run();
  });
}
