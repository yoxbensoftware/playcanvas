import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  port: parseInt(process.env.PORT) || 3001,
  filesystemUrl: process.env.FILESYSTEM_URL || 'http://localhost:3002',
  uploadsDir: path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads'),
  framesDir: path.resolve(__dirname, '..', process.env.FRAMES_DIR || 'uploads/frames'),
  processor: process.env.PROCESSOR || 'mock',
  lumaApiKey: process.env.LUMA_API_KEY || null,
};
