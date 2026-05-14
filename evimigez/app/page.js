import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* ── Navigation ── */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-orange-500 font-black text-2xl tracking-tight">evimigez</span>
            <span className="text-white/20 text-sm font-medium">.com</span>
          </div>
          <div className="flex items-center gap-8">
            <Link
              href="/upload"
              className="text-white/50 hover:text-white text-sm transition-colors hidden sm:block"
            >
              3D Render
            </Link>
            <Link
              href="/upload"
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              Hemen Başla
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-36 pb-28 px-6 relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-1.5 mb-10">
            <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
            <span className="text-orange-400 text-xs font-semibold tracking-wide uppercase">
              Beta — İlk 100 kullanıcıya ücretsiz
            </span>
          </div>

          <h1 className="text-5xl md:text-[5.5rem] font-black tracking-tight leading-[0.95] mb-8">
            Evinizi{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600">
              3 boyutlu
            </span>
            <br />
            paylaşın.
          </h1>

          <p className="text-white/45 text-lg md:text-xl max-w-xl mx-auto leading-relaxed mb-12">
            Evinizin videosunu çekin. Sanal tur oluşturun.{' '}
            <strong className="text-white/70 font-medium">Sahibinden</strong>,{' '}
            <strong className="text-white/70 font-medium">Emlakjet</strong>,{' '}
            <strong className="text-white/70 font-medium">HepsiEmlak</strong> — her yerde 3D link
            paylaşın.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/upload"
              className="group bg-orange-500 hover:bg-orange-600 text-white font-bold px-9 py-4 rounded-xl text-lg transition-all hover:shadow-xl hover:shadow-orange-500/20 hover:scale-[1.02]"
            >
              3D Render Oluştur{' '}
              <span className="group-hover:translate-x-0.5 inline-block transition-transform">→</span>
            </Link>
            <a
              href="http://localhost:3002/viewer/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 hover:text-white border border-white/10 hover:border-white/25 px-9 py-4 rounded-xl text-lg transition-all"
            >
              Demo İzle
            </a>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-24 px-6 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto">
          <p className="text-orange-500 text-xs font-bold tracking-widest text-center uppercase mb-3">
            Nasıl Çalışır?
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            3 adımda 3D ev ilanı
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 relative">
            {/* Connector line (desktop only) */}
            <div className="hidden md:block absolute top-[52px] left-[calc(33.3%+24px)] right-[calc(33.3%+24px)] h-px bg-gradient-to-r from-orange-500/30 via-orange-500/60 to-orange-500/30" />

            {[
              {
                step: '01',
                emoji: '📹',
                title: 'Video veya Fotoğraf Yükle',
                desc: 'Evin içini ve dışını dönerek çektiğiniz bir video ya da çok açılı fotoğraflar yükleyin.',
              },
              {
                step: '02',
                emoji: '⚡',
                title: '3D\'ye Dönüştür',
                desc: 'Sistemimiz Gaussian Splatting teknolojisiyle görüntülerinizden interaktif 3D sahne üretir.',
              },
              {
                step: '03',
                emoji: '🔗',
                title: 'Link Paylaş',
                desc: 'Oluşturulan benzersiz linki ilan sayfanıza, WhatsApp\'a veya e-postaya yapıştırın.',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="glass glass-hover rounded-2xl p-7 flex flex-col items-start relative"
              >
                <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-2xl mb-5">
                  {item.emoji}
                </div>
                <span className="text-orange-500 text-[10px] font-black tracking-[0.2em] uppercase mb-2">
                  ADIM {item.step}
                </span>
                <h3 className="font-bold text-base mb-2">{item.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature highlights ── */}
      <section className="py-16 px-6 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'WebGL/WebGPU', desc: 'Tarayıcıda çalışır, uygulama gerekmez' },
            { label: 'Paylaşılabilir link', desc: 'Tek tıkla kopyala, her yere yapıştır' },
            { label: 'Mobil uyumlu', desc: 'iPhone, Android, tablet — her cihazda' },
            { label: 'PlayCanvas altyapı', desc: 'MIT lisanslı açık kaynak motor' },
          ].map((f, i) => (
            <div key={i} className="glass rounded-xl p-5">
              <div className="text-orange-500 font-bold text-sm mb-1">{f.label}</div>
              <div className="text-white/35 text-xs leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <div className="glass glass-hover rounded-3xl p-12 bg-gradient-to-b from-orange-500/8 to-transparent border-orange-500/15">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ücretsiz deneyin</h2>
            <p className="text-white/40 mb-10 text-base">
              Kayıt gerekmez. 3D dosyanızı 30 saniyede yükleyin, linkinizi alın.
            </p>
            <Link
              href="/upload"
              className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-bold px-10 py-4 rounded-xl text-lg transition-all hover:shadow-xl hover:shadow-orange-500/20"
            >
              Hemen Başla
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-white/25 text-sm">
          <span className="text-orange-500 font-black tracking-tight text-lg">evimigez</span>
          <span>© 2026 evimigez.com — Türkiye&apos;nin 3D Emlak Platformu</span>
        </div>
      </footer>
    </div>
  );
}
