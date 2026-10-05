import { fetchMacRelease } from '@/lib/release';
import type { Lang } from '@/lib/i18n';
import { LINKS } from '@/lib/site';
import { UI } from '@/lib/ui';
import { WindowsIcon } from './Icons';
import { DownloadButton } from './ReleaseInfo';

export async function DownloadCta({ lang, title }: { lang: Lang; title?: string }) {
  const text = UI[lang];
  const release = await fetchMacRelease({ cache: 'force-cache' });
  return (
    <aside className="final-cta page-cta">
      <img src="/logo-256.png" width={72} height={72} alt="" />
      <h2>{title ?? text.cta.title}</h2>
      <p>{text.cta.text}</p>
      <div className="cta">
        <DownloadButton initial={release} className="btn btn-white" />
        <a className="btn btn-outline-light" href={LINKS.downloadWindows}>
          <WindowsIcon />
          <span className="btn-stack">
            {text.download.win}
            <span className="sub">{text.download.winSub}</span>
          </span>
        </a>
      </div>
    </aside>
  );
}
