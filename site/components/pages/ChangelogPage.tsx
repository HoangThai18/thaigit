import { AppleIcon, WindowsIcon } from '@/components/Icons';
import { DownloadCta } from '@/components/DownloadCta';
import { Breadcrumbs } from '@/components/Seo';
import { formatDate, readChangelog } from '@/lib/changelog';
import { PATHS, type Lang } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';

export async function ChangelogPage({ lang }: { lang: Lang }) {
  const text = PAGE_TEXT[lang].changelog;
  const lanes = await readChangelog(Number.POSITIVE_INFINITY);
  return (
    <article className="prose container">
      <Breadcrumbs lang={lang} items={[{ name: text.h1, path: PATHS.changelog[lang] }]} />
      <h1>{text.h1}</h1>
      <p className="lead">{text.lead}</p>
      {text.note && <p className="updated">{text.note}</p>}
      <nav className="changelog-jump" aria-label="macOS / Windows">
        {lanes.map((lane) => (
          <a key={lane.platform} href={`#${lane.platform === 'Windows' ? 'windows' : 'macos'}`}>
            {lane.platform === 'Windows' ? <WindowsIcon size={16} /> : <AppleIcon size={16} />}{' '}
            {lane.platform}
          </a>
        ))}
      </nav>
      {lanes.map((lane) => (
        <section key={lane.platform} id={lane.platform === 'Windows' ? 'windows' : 'macos'}>
          <h2>{lane.platform}</h2>
          {lane.entries.map((entry) => (
            <div key={entry.version} className="changelog-entry">
              <h3>
                {entry.version}
                {entry.date && <time dateTime={entry.date}>{formatDate(entry.date, lang)}</time>}
              </h3>
              {entry.summary && <p>{entry.summary}</p>}
              <ul>
                {entry.items.map((item, index) => (
                  <li key={index}>
                    <strong>{item.title}</strong>
                    {item.detail && <> — {item.detail}</>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <DownloadCta lang={lang} />
    </article>
  );
}
