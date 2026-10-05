import Link from 'next/link';
import { PATHS, type Lang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { UI } from '@/lib/ui';

export function Footer({ lang }: { lang: Lang }) {
  const text = UI[lang].footer;
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-brand">
          <img src="/logo-96.png" width={28} height={28} alt="" />
          <div>
            <strong>Thaigit</strong> — {text.tagline}
            <br />© {new Date().getFullYear()} {SITE.author}
            <small>{text.disclaimer}</small>
          </div>
        </div>
        <nav className="footer-links" aria-label={text.aria}>
          <Link href={PATHS.mac[lang]}>{text.mac}</Link>
          <Link href={PATHS.windows[lang]}>{text.windows}</Link>
          <Link href={PATHS.guides[lang]}>{text.guides}</Link>
          <Link href={PATHS.changelog[lang]}>{text.changelog}</Link>
          <Link href={PATHS.privacy[lang]}>{text.privacy}</Link>
        </nav>
      </div>
    </footer>
  );
}
