import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { LINKS, SITE } from '@/lib/site';
import './globals.css';

// Font tiếng Việt tự host lúc build (không gọi Google khi người dùng mở trang).
const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: '%s · Thaigit' },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    'Thaigit',
    'git client',
    'git gui',
    'phần mềm git',
    'git miễn phí',
    'thay thế GitKraken',
    'thay thế SourceTree',
    'git cho macOS',
    'git cho Windows',
    'stage từng dòng',
    'giải conflict git',
    'git tiếng Việt',
  ],
  authors: [{ name: SITE.author, url: LINKS.github }],
  creator: SITE.author,
  publisher: SITE.author,
  category: 'technology',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'vi_VN',
    url: '/',
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0c111d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable}>
      <body>
        <a className="skip-link" href="#noi-dung">
          Bỏ qua tới nội dung
        </a>
        <div className="backdrop" aria-hidden="true" />
        <Header />
        <main id="noi-dung">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
