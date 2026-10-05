import { Be_Vietnam_Pro } from 'next/font/google';
import { Footer } from './Footer';
import { Header } from './Header';
import { LangProvider } from './LangProvider';
import type { Lang } from '@/lib/i18n';
import { UI } from '@/lib/ui';
import './../app/globals.css';

const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});

const THEME_SCRIPT = `try{var t=localStorage.getItem('tg-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;

export function RootShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <html lang={lang} className={font.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <LangProvider lang={lang}>
          <a className="skip-link" href="#noi-dung">
            {UI[lang].skip}
          </a>
          <Header lang={lang} />
          <main id="noi-dung">{children}</main>
          <Footer lang={lang} />
        </LangProvider>
      </body>
    </html>
  );
}
