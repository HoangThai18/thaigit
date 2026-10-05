import Link from 'next/link';
import { LangSwitch } from './LangSwitch';
import { ThemeToggle } from './ThemeToggle';
import { PATHS, type Lang } from '@/lib/i18n';
import { UI } from '@/lib/ui';

export function Header({ lang }: { lang: Lang }) {
  const text = UI[lang];
  const home = PATHS.home[lang];
  return (
    <header className="site-header glass">
      <div className="container">
        <Link className="brand" href={home} aria-label={text.brandAria}>
          <img src="/logo-96.png" width={34} height={34} alt="" />
          Thaigit
        </Link>
        <nav className="nav" aria-label={text.navAria}>
          <a href={`${home}#tinh-nang`}>{text.nav.features}</a>
          <Link href={PATHS.guides[lang]}>{text.nav.guides}</Link>
          <a href={`${home}#tai-ve`}>{text.nav.download}</a>
          <a href={`${home}#hoi-dap`}>{text.nav.faq}</a>
        </nav>
        <div className="header-actions">
          <LangSwitch />
          <ThemeToggle />
          <a className="btn btn-primary btn-small" href={`${home}#tai-ve`}>
            {text.headerDownload}
          </a>
        </div>
      </div>
    </header>
  );
}
