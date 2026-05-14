'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';

const RENDER_ENGINE = process.env.NEXT_PUBLIC_RENDER_ENGINE_URL || 'http://localhost:3001';
const FILESYSTEM = process.env.NEXT_PUBLIC_FILESYSTEM_URL || 'http://localhost:3002';

// ─── Stage machine ───────────────────────────────────────────────────────────
const S = { IDLE: 'idle', UPLOADING: 'uploading', PROCESSING: 'processing', DONE: 'done', ERROR: 'error' };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const JOB_LABELS = {
  queued:      'Sıraya alındı…',
  extracting:  'Frame\'ler çıkarılıyor…',
  processing:  '3D sahne işleniyor…',
  done:        'Tamamlandı',
  failed:      'İşlem başarısız',
};

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function NavBar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-orange-500 font-black text-xl tracking-tight">
          evimigez
        </Link>
        <span className="text-white/30 text-sm hidden sm:block">3D Render Oluştur</span>
      </div>
    </nav>
  );
}

function DropZone({ onFile, accept, hint, isDragging, onDragOver, onDragLeave, onDrop, file }) {
  const inputRef = useRef();
  return (
    <div
      className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer
        ${isDragging ? 'border-orange-500 bg-orange-500/5' : 'border-white/10 hover:border-white/25 bg-white/[0.02]'}
        ${file ? 'border-green-500/40 bg-green-500/5' : ''}
      `}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      <div className="py-12 px-6 flex flex-col items-center justify-center gap-3 text-center">
        {file ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center text-2xl">✅</div>
            <div>
              <p className="font-semibold text-white truncate max-w-xs">{file.name}</p>
              <p className="text-white/40 text-sm">{fmt(file.size)}</p>
            </div>
            <p className="text-white/30 text-xs">Değiştirmek için tıkla</p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-3xl">
              {isDragging ? '📂' : '📁'}
            </div>
            <div>
              <p className="font-medium text-white/70">Dosyayı buraya sürükle veya tıkla</p>
              <p className="text-white/35 text-sm mt-1">{hint}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }) {
  return (
    <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
      <span className="text-red-400 mt-0.5">⚠</span>
      <div className="flex-1">
        <p className="text-red-300 text-sm">{msg}</p>
      </div>
      <button onClick={onDismiss} className="text-white/30 hover:text-white/60 text-lg leading-none">×</button>
    </div>
  );
}

function ResultCard({ viewerUrl, downloadUrl, shortId, onCopy, copied }) {
  return (
    <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-lg">✅</span>
        <div>
          <p className="font-bold text-green-400">3D sahne hazır!</p>
          <p className="text-white/40 text-xs">Link ID: {shortId}</p>
        </div>
      </div>

      <div className="bg-white/[0.04] rounded-xl p-3 flex items-center gap-3">
        <span className="text-white/50 text-sm truncate flex-1 font-mono">{viewerUrl}</span>
        <button
          onClick={onCopy}
          className={`shrink-0 text-sm font-semibold px-3 py-1.5 rounded-lg transition-all
            ${copied ? 'bg-green-500/20 text-green-400' : 'bg-white/10 hover:bg-white/15 text-white'}`}
        >
          {copied ? '✓ Kopyalandı' : 'Kopyala'}
        </button>
      </div>

      <div className="flex gap-3">
        <a
          href={viewerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
        >
          3D Görünümü Aç ↗
        </a>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl text-sm transition-colors border border-white/10"
          >
            İndir
          </a>
        )}
      </div>

      <p className="text-white/25 text-xs text-center">
        Bu linki sahibinden ilanınıza, WhatsApp grubuna veya e-postaya yapıştırabilirsiniz.
      </p>
    </div>
  );
}

// ─── Tab 1: Video / Photo → Render Pipeline ───────────────────────────────────
function PipelineTab() {
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState(S.IDLE);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const pollRef = useRef(null);

  const handleFile = useCallback((f) => {
    const ok = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
                 'image/jpeg', 'image/png', 'image/webp'];
    if (!ok.includes(f.type)) {
      setError('Desteklenmeyen format. MP4, MOV, AVI, WebM, JPG veya PNG yükleyin.');
      return;
    }
    setError(null);
    setFile(f);
    setStage(S.IDLE);
    setJob(null);
    clearInterval(pollRef.current);
  }, []);

  const start = async () => {
    if (!file) return;
    setStage(S.UPLOADING);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${RENDER_ENGINE}/api/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Yükleme başarısız');
      const { jobId } = await res.json();
      setStage(S.PROCESSING);
      setJob({ id: jobId, status: 'queued', progress: 0 });

      pollRef.current = setInterval(async () => {
        try {
          const jr = await fetch(`${RENDER_ENGINE}/api/jobs/${jobId}`);
          const j = await jr.json();
          setJob(j);
          if (j.status === 'done') { clearInterval(pollRef.current); setStage(S.DONE); }
          if (j.status === 'failed') {
            clearInterval(pollRef.current);
            setStage(S.ERROR);
            setError(j.error || 'İşlem başarısız oldu');
          }
        } catch { /* network blip, keep polling */ }
      }, 2000);
    } catch (e) {
      setStage(S.ERROR);
      setError(e.message);
    }
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setFile(null); setStage(S.IDLE); setJob(null); setError(null);
  };

  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-5 space-y-3">
        <p className="text-white/50 text-sm leading-relaxed">
          Evinizin içini ve dışını <strong className="text-white/80">dönerek çektiğiniz bir video</strong> yükleyin.
          Sistem frame'leri çıkarıp 3D Gaussian Splatting ile işler.
        </p>
        <div className="flex gap-4 text-xs text-white/30">
          <span>📹 MP4, MOV, AVI, WebM</span>
          <span>🖼 JPG, PNG, WebP</span>
          <span>📦 Maks 500 MB</span>
        </div>
      </div>

      {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}

      {stage === S.IDLE || stage === S.ERROR ? (
        <>
          <DropZone
            file={file}
            accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,image/jpeg,image/png,image/webp"
            hint="MP4, MOV, AVI, WebM • JPG, PNG, WebP • Maks 500 MB"
            isDragging={isDragging}
            onFile={handleFile}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
          />
          <button
            onClick={start}
            disabled={!file}
            className="w-full py-4 rounded-xl font-bold text-base transition-all
              disabled:bg-white/5 disabled:text-white/20 disabled:cursor-not-allowed
              enabled:bg-orange-500 enabled:hover:bg-orange-600 enabled:text-white enabled:hover:shadow-lg enabled:hover:shadow-orange-500/20"
          >
            ⚡ Render Pipeline&apos;ı Başlat
          </button>
        </>
      ) : stage === S.UPLOADING ? (
        <div className="glass rounded-2xl p-8 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
          <p className="text-white/60 text-sm">Dosya yükleniyor…</p>
          <ProgressBar value={30} />
        </div>
      ) : stage === S.PROCESSING ? (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{JOB_LABELS[job?.status] || 'İşleniyor…'}</span>
            <span className="text-orange-500 font-bold text-sm">{job?.progress ?? 0}%</span>
          </div>
          <ProgressBar value={job?.progress ?? 0} />

          <div className="grid grid-cols-3 gap-3 pt-1">
            {[
              { key: 'extracting', label: 'Frame Çıkarma' },
              { key: 'processing', label: '3D İşleme' },
              { key: 'done',       label: 'Tamamlandı' },
            ].map(({ key, label }) => {
              const statuses = ['extracting', 'processing', 'done'];
              const curIdx = statuses.indexOf(job?.status);
              const myIdx = statuses.indexOf(key);
              const done = curIdx > myIdx;
              const active = curIdx === myIdx;
              return (
                <div key={key} className={`rounded-xl p-3 text-center transition-all
                  ${done ? 'bg-green-500/10 border border-green-500/20' :
                    active ? 'bg-orange-500/10 border border-orange-500/30' :
                    'bg-white/[0.02] border border-white/5'}`}>
                  <div className="text-lg mb-1">{done ? '✅' : active ? '⚡' : '⏳'}</div>
                  <div className={`text-xs font-medium ${done ? 'text-green-400' : active ? 'text-orange-400' : 'text-white/25'}`}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-white/25 text-xs text-center">Job ID: {job?.id?.slice(0, 8)}…</p>
        </div>
      ) : stage === S.DONE ? (
        <div className="space-y-4">
          {job?.result?.viewerUrl ? (
            /* Gerçek 3DGS tamamlandı — viewer linki göster */
            <>
              <ResultCard
                viewerUrl={job.result.viewerUrl}
                downloadUrl={job.result.downloadUrl}
                shortId={job.result.fileId?.slice(0, 8)}
                onCopy={async () => {
                  await navigator.clipboard.writeText(job.result.viewerUrl);
                }}
                copied={false}
              />
              <button onClick={reset} className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors">
                Yeni Render Başlat
              </button>
            </>
          ) : (
            /* Mock mod — gerçek .ply üretilmedi */
            <>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-6">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-2xl">🔬</span>
                  <div>
                    <p className="font-bold text-blue-300">Pipeline tamamlandı (mock mod)</p>
                    <p className="text-white/40 text-sm mt-1">
                      Şu an <strong className="text-white/60">mock processor</strong> aktif. Gerçek .ply dosyası üretilmedi.
                      Gerçek 3DGS için <code className="bg-white/10 px-1 rounded text-xs">PROCESSOR=lumaai</code> ayarla.
                    </p>
                  </div>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-3 text-xs font-mono text-white/40 overflow-auto max-h-32">
                  {JSON.stringify(job?.result, null, 2)}
                </div>
              </div>

              <p className="text-white/40 text-sm text-center">
                Hazır bir <strong className="text-white/70">.ply</strong> dosyanız varsa{' '}
                <button
                  onClick={reset}
                  className="text-orange-500 hover:text-orange-400 underline"
                >
                  3D Dosya sekmesini
                </button>{' '}
                kullanarak direkt viewer linki alabilirsiniz.
              </p>

              <button onClick={reset} className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors">
                Yeni Render Başlat
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Tab 2: Direct .ply / .glb Upload ────────────────────────────────────────
function DirectTab() {
  const [file, setFile] = useState(null);
  const [label, setLabel] = useState('');
  const [stage, setStage] = useState(S.IDLE);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleFile = useCallback((f) => {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!['.ply', '.splat', '.glb', '.gltf'].includes(ext)) {
      setError('Desteklenmeyen format. .ply, .splat, .glb veya .gltf yükleyin.');
      return;
    }
    setError(null);
    setFile(f);
    setStage(S.IDLE);
    setResult(null);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, ''));
  }, [label]);

  const upload = async () => {
    if (!file) return;
    setStage(S.UPLOADING);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label || file.name);
      const res = await fetch(`${FILESYSTEM}/api/files`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Yükleme başarısız');
      setResult(await res.json());
      setStage(S.DONE);
    } catch (e) {
      setStage(S.ERROR);
      setError(e.message);
    }
  };

  const copyLink = async () => {
    if (!result?.viewerUrl) return;
    await navigator.clipboard.writeText(result.viewerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setFile(null); setLabel(''); setStage(S.IDLE); setResult(null); setError(null);
  };

  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-5 space-y-3">
        <p className="text-white/50 text-sm leading-relaxed">
          Elinizdeki hazır bir <strong className="text-white/80">.ply</strong> veya{' '}
          <strong className="text-white/80">.glb</strong> dosyasını yükleyin. Anında viewer linki alın.
        </p>
        <div className="flex gap-4 text-xs text-white/30">
          <span>🎯 .ply, .splat (Gaussian Splat)</span>
          <span>📦 .glb, .gltf (3D Model)</span>
          <span>📏 Maks 2 GB</span>
        </div>
      </div>

      {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}

      {(stage === S.IDLE || stage === S.ERROR) && (
        <>
          <DropZone
            file={file}
            accept=".ply,.splat,.glb,.gltf"
            hint=".ply, .splat, .glb, .gltf • Maks 2 GB"
            isDragging={isDragging}
            onFile={handleFile}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
          />

          {file && (
            <div className="space-y-2">
              <label className="text-white/50 text-sm font-medium block">
                İlan / Sahne Başlığı
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="örn. Kadıköy 3+1 Daire"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-orange-500/50 transition-colors text-sm"
              />
            </div>
          )}

          <button
            onClick={upload}
            disabled={!file}
            className="w-full py-4 rounded-xl font-bold text-base transition-all
              disabled:bg-white/5 disabled:text-white/20 disabled:cursor-not-allowed
              enabled:bg-orange-500 enabled:hover:bg-orange-600 enabled:text-white enabled:hover:shadow-lg enabled:hover:shadow-orange-500/20"
          >
            🚀 Yükle ve Link Oluştur
          </button>
        </>
      )}

      {stage === S.UPLOADING && (
        <div className="glass rounded-2xl p-8 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
          <p className="text-white/60 text-sm">Dosya yükleniyor…</p>
          <ProgressBar value={60} />
        </div>
      )}

      {stage === S.DONE && result && (
        <div className="space-y-4">
          <ResultCard
            viewerUrl={result.viewerUrl}
            downloadUrl={result.downloadUrl}
            shortId={result.shortId}
            onCopy={copyLink}
            copied={copied}
          />
          <button
            onClick={reset}
            className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors"
          >
            Yeni Dosya Yükle
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const [tab, setTab] = useState('direct'); // 'pipeline' | 'direct'

  const tabs = [
    { id: 'pipeline', icon: '📹', label: 'Video / Fotoğraf',     sub: 'render pipeline' },
    { id: 'direct',   icon: '🎯', label: '3D Dosya (.ply / .glb)', sub: 'direkt yükle'     },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <NavBar />

      <main className="pt-24 pb-24 px-6">
        <div className="max-w-2xl mx-auto">
          {/* Page header */}
          <div className="mb-10">
            <Link href="/" className="text-white/30 hover:text-white/60 text-sm transition-colors inline-flex items-center gap-1 mb-6">
              ← Ana Sayfa
            </Link>
            <h1 className="text-3xl font-bold mb-2">3D Render Oluştur</h1>
            <p className="text-white/40 text-sm">
              Video yükleyerek render pipeline&apos;ı başlatın ya da hazır 3D dosyanızı direkt yükleyin.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex bg-white/[0.04] rounded-2xl p-1.5 mb-8 gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 rounded-xl text-sm font-medium transition-all
                  ${tab === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-white/35 hover:text-white/60'}`}
              >
                <span className="text-base">{t.icon}</span>
                <span className="leading-tight">{t.label}</span>
                <span className={`text-[10px] ${tab === t.id ? 'text-orange-400' : 'text-white/20'}`}>
                  {t.sub}
                </span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'pipeline' ? <PipelineTab /> : <DirectTab />}
        </div>
      </main>
    </div>
  );
}
