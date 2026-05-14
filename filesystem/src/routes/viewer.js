import { Router } from 'express';
import config from '../config.js';
import { resolveLink } from '../store/fileStore.js';

const router = Router();

// GET /view/:shortId
// supersplat-viewer'ı ?content=<fileUrl> ile açar
router.get('/:shortId', (req, res) => {
  const file = resolveLink(req.params.shortId);
  if (!file) {
    return res.status(404).send(notFoundPage());
  }

  const fileUrl = `${config.viewerBaseUrl}/api/files/${file.id}/raw`;

  // supersplat-viewer'ı content parametresiyle yönlendir
  // Viewer /viewer/index.html altında serve ediliyor
  const viewerUrl = `/viewer/index.html?content=${encodeURIComponent(fileUrl)}&noui=false`;
  res.redirect(302, viewerUrl);
});

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Bulunamadı — evimigez</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center}.box a{color:#e85d04;font-weight:700;text-decoration:none}
</style>
</head>
<body>
  <div class="box">
    <h2>Link bulunamadı</h2>
    <p>Bu 3D görüntüleme linki geçersiz veya süresi dolmuş.</p>
    <a href="/">evimigez.com</a>
  </div>
</body>
</html>`;
}

export default router;
