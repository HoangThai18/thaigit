import { fetchRelease } from '@/lib/release';
import type { Lang } from '@/lib/i18n';
import { UI } from '@/lib/ui';
import { DownloadButton } from './ReleaseInfo';

export async function DownloadCta({ lang, title }: { lang: Lang; title?: string }) {
  const text = UI[lang];
  const release = await fetchRelease({ cache: 'force-cache' });
  return (
    <aside className="final-cta page-cta">
      <img src="/logo-256.png" width={72} height={72} alt="" />
      <h2>{title ?? text.cta.title}</h2>
      <p>{text.cta.text}</p>
      <div className="cta">
        <DownloadButton os="mac" initial={release} className="btn btn-white" />
        <DownloadButton os="win" initial={release} className="btn btn-outline-light" />
      </div>
    </aside>
  );
}
