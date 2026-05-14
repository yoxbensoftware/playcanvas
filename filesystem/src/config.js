import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  port: parseInt(process.env.PORT) || 3002,
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || 'data'),
  viewerBaseUrl: (process.env.VIEWER_BASE_URL || 'http://localhost:3002').replace(/\/$/, ''),
  viewerDist: path.resolve(
    __dirname,
    '..',
    process.env.VIEWER_DIST || '../supersplat-viewer/public'
  ),
};
