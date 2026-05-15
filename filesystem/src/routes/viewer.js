import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { resolveLink } from '../store/fileStore.js';

const router = Router();

// GET /view/:shortId
router.get('/:shortId', (req, res) => {
  const file = resolveLink(req.params.shortId);
  if (!file) {
    return res.status(404).send(notFoundPage());
  }

  const fileUrl = `${config.viewerBaseUrl}/api/files/${file.id}/raw`;
  const downloadUrl = fileUrl;
  const support = getViewerSupport(file);
  const label = file.label || file.originalName || 'Model';

  if (support.isGaussianSplat) {
    // Gaussian splat → supersplat-viewer
    const gsUrl = `/viewer/index.html?content=${encodeURIComponent(fileUrl)}&noui=false`;
    return res.send(wrapperPage({ fileUrl, downloadUrl, label, embedUrl: gsUrl, type: 'splat' }));
  }

  if (support.isPointCloud) {
    // Point-cloud PLY → embedded Three.js viewer
    return res.send(pointCloudPage({ fileUrl, downloadUrl, label }));
  }

  // GLB/GLTF or other — supersplat-viewer handles these too
  const gsUrl = `/viewer/index.html?content=${encodeURIComponent(fileUrl)}&noui=false`;
  return res.send(wrapperPage({ fileUrl, downloadUrl, label, embedUrl: gsUrl, type: 'model' }));
});

function getViewerSupport(file) {
  const ext = path.extname(file.originalName || file.filename || '').toLowerCase();

  if (ext === '.splat') return { isGaussianSplat: true, isPointCloud: false };
  if (ext === '.glb' || ext === '.gltf') return { isGaussianSplat: false, isPointCloud: false };

  if (ext !== '.ply') return { isGaussianSplat: false, isPointCloud: false };

  // Check PLY header
  try {
    const filePath = path.join(config.dataDir, file.filename);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(32 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const isGS =
      /property\s+float\s+scale_0/.test(header) ||
      /property\s+float\s+opacity/.test(header) ||
      /property\s+float\s+f_dc_0/.test(header);
    return { isGaussianSplat: isGS, isPointCloud: !isGS };
  } catch {
    return { isGaussianSplat: false, isPointCloud: true };
  }
}

// Wrapper page: supersplat-viewer inside an iframe with download button
function wrapperPage({ fileUrl, downloadUrl, label, embedUrl, type }) {
  const icon = type === 'splat' ? '✨' : '📦';
  const typeLabel = type === 'splat' ? 'Gaussian Splat' : '3D Model';
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(label)} — evimigez 3D</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#111;border-bottom:1px solid #222;flex-shrink:0}
  .bar-logo{color:#ff7b1a;font-weight:900;font-size:18px;text-decoration:none}
  .bar-title{flex:1;font-size:14px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-badge{font-size:11px;background:#222;border:1px solid #333;border-radius:6px;padding:3px 8px;color:#aaa}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;transition:opacity .15s}
  .btn:hover{opacity:.85}
  .btn-dl{background:#ff7b1a;color:#fff}
  .btn-share{background:#1e293b;color:#94a3b8;border:1px solid #334}
  .viewer-wrap{flex:1;position:relative;overflow:hidden}
  iframe{width:100%;height:100%;border:none;display:block}
  #share-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#22c55e;color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;opacity:0;pointer-events:none;transition:all .3s}
  #share-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="bar">
  <a class="bar-logo" href="/">evimigez</a>
  <span class="bar-title">${icon} ${escHtml(label)}</span>
  <span class="bar-badge">${typeLabel}</span>
  <button class="btn btn-share" onclick="copyLink()">🔗 Linki Kopyala</button>
  <a class="btn btn-dl" href="${downloadUrl}" download>⬇ İndir</a>
</div>
<div class="viewer-wrap">
  <iframe src="${embedUrl}" allow="fullscreen" allowfullscreen></iframe>
</div>
<div id="share-toast">✓ Link kopyalandı!</div>
<script>
  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      const t = document.getElementById('share-toast');
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2200);
    });
  }
</script>
</body>
</html>`;
}

// Point-cloud PLY viewer: Three.js ile tam 3D görüntüleme
function pointCloudPage({ fileUrl, downloadUrl, label }) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(label)} — evimigez 3D</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#111;border-bottom:1px solid #222;flex-shrink:0;z-index:10}
  .bar-logo{color:#ff7b1a;font-weight:900;font-size:18px;text-decoration:none}
  .bar-title{flex:1;font-size:14px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-badge{font-size:11px;background:#222;border:1px solid #333;border-radius:6px;padding:3px 8px;color:#aaa}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;border:none;transition:opacity .15s}
  .btn:hover{opacity:.85}
  .btn-dl{background:#ff7b1a;color:#fff}
  .btn-share{background:#1e293b;color:#94a3b8;border:1px solid #334}
  #canvas-wrap{flex:1;position:relative;overflow:hidden}
  canvas{display:block;width:100%!important;height:100%!important}
  #overlay{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:#111a;border:1px solid #334;border-radius:10px;padding:8px 16px;font-size:12px;color:#9fb3c8;pointer-events:none;white-space:nowrap}
  #loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0a;gap:16px;z-index:5}
  #loading-bar-wrap{width:240px;height:4px;background:#1e293b;border-radius:4px;overflow:hidden}
  #loading-bar{height:100%;background:#ff7b1a;border-radius:4px;transition:width .2s;width:0}
  #loading-text{font-size:13px;color:#9fb3c8}
  #error-msg{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0a;gap:12px;color:#f87171}
  #share-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#22c55e;color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;opacity:0;pointer-events:none;transition:all .3s}
  #share-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="bar">
  <a class="bar-logo" href="/">evimigez</a>
  <span class="bar-title">☁ ${escHtml(label)}</span>
  <span class="bar-badge">Point Cloud</span>
  <button class="btn btn-share" onclick="copyLink()">🔗 Linki Kopyala</button>
  <a class="btn btn-dl" href="${downloadUrl}" download>⬇ İndir</a>
</div>
<div id="canvas-wrap">
  <div id="loading">
    <div style="font-size:28px">☁</div>
    <div id="loading-text">Point cloud yükleniyor…</div>
    <div id="loading-bar-wrap"><div id="loading-bar"></div></div>
  </div>
  <div id="error-msg">
    <div style="font-size:32px">⚠</div>
    <div id="error-text">Dosya yüklenemedi</div>
    <a class="btn btn-dl" style="margin-top:8px" href="${downloadUrl}" download>⬇ Yine de İndir</a>
  </div>
  <canvas id="c"></canvas>
  <div id="overlay">Sol tık: döndür &nbsp;|&nbsp; Sağ tık / iki parmak: kaydır &nbsp;|&nbsp; Scroll: yakınlaştır</div>
</div>
<div id="share-toast">✓ Link kopyalandı!</div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const wrap = document.getElementById('canvas-wrap');
const canvas = document.getElementById('c');
const loading = document.getElementById('loading');
const errorDiv = document.getElementById('error-msg');
const errorText = document.getElementById('error-text');
const bar = document.getElementById('loading-bar');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a0a);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
camera.position.set(0, 1, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.1;
controls.maxDistance = 500;

// Dim ambient + directional so point colours stay true
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(1, 2, 3);
scene.add(dir);

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const loader = new PLYLoader();

loader.load(
  '${fileUrl}',
  (geometry) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Centre the point cloud
    const centre = new THREE.Vector3();
    geometry.boundingBox.getCenter(centre);
    geometry.translate(-centre.x, -centre.y, -centre.z);

    const radius = geometry.boundingSphere.radius;
    camera.position.set(0, radius * 0.5, radius * 2.5);
    controls.maxDistance = radius * 20;

    const hasColors = geometry.hasAttribute('color');
    const material = new THREE.PointsMaterial({
      size: Math.max(0.002, radius * 0.003),
      vertexColors: hasColors,
      color: hasColors ? 0xffffff : 0x88bbff,
      sizeAttenuation: true,
    });

    scene.add(new THREE.Points(geometry, material));
    loading.style.display = 'none';
    canvas.style.display = 'block';
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100) : 0;
    bar.style.width = pct + '%';
    document.getElementById('loading-text').textContent =
      'Yükleniyor… ' + Math.round(pct) + '%';
  },
  (err) => {
    console.error(err);
    loading.style.display = 'none';
    errorText.textContent = 'Dosya yüklenemedi: ' + (err?.message || err);
    errorDiv.style.display = 'flex';
  }
);

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();
</script>
<script>
function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const t = document.getElementById('share-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  });
}
</script>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
