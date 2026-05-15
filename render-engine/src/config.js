import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env her zaman render-engine/ kök dizininden yüklenir (cwd'den bağımsız)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export default {
  port: parseInt(process.env.PORT) || 3001,
  filesystemUrl: process.env.FILESYSTEM_URL || 'http://localhost:3002',
  uploadsDir: path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads'),
  framesDir: path.resolve(__dirname, '..', process.env.FRAMES_DIR || 'uploads/frames'),
  processor: process.env.PROCESSOR || 'mock',
  lumaApiKey: process.env.LUMA_API_KEY || null,
  colmapExe: process.env.COLMAP_EXE || 'C:\\Users\\ozgen\\OneDrive\\Masaüstü\\playcanvas\\colmap-x64-windows-cuda\\bin\\colmap.exe',
  nsProcessData: process.env.NS_PROCESS_DATA || 'C:\\Users\\ozgen\\miniconda3\\envs\\nerfstudio\\Scripts\\ns-process-data.exe',
  nsTrain: process.env.NS_TRAIN || 'C:\\Users\\ozgen\\miniconda3\\envs\\nerfstudio\\Scripts\\ns-train.exe',
  nsExport: process.env.NS_EXPORT || 'C:\\Users\\ozgen\\miniconda3\\envs\\nerfstudio\\Scripts\\ns-export.exe',
};
