import './globals.css';

export const metadata = {
  title: 'evimigez — Evinizi 3D Paylaşın',
  description:
    'Evinizin videosunu çekin, 3D sanal tur oluşturun. Sahibinden gibi platformlarda 3D link paylaşın.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" data-scroll-behavior="smooth">
      <body className="bg-[#0a0a0a] text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
