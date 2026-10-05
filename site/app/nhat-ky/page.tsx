import type { Metadata } from 'next';
import { DownloadCta } from '@/components/DownloadCta';
import { AppleIcon, WindowsIcon } from '@/components/Icons';
import { Breadcrumbs } from '@/components/Seo';
import { formatDate, readChangelog } from '@/lib/changelog';
import { pageMetadata } from '@/lib/seo';

const TITLE = 'Nhật ký thay đổi — Thaigit có gì mới';
const DESCRIPTION =
  'Toàn bộ tính năng mới và sửa lỗi của Thaigit qua từng phiên bản, cho cả macOS và Windows.';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/nhat-ky/' });

export default async function ChangelogPage() {
  const lanes = await readChangelog(Number.POSITIVE_INFINITY);
  return (
    <article className="prose container">
      <Breadcrumbs items={[{ name: 'Nhật ký thay đổi', path: '/nhat-ky/' }]} />
      <h1>Nhật ký thay đổi</h1>
      <p className="lead">
        Những gì mới trong từng phiên bản Thaigit. App tự cập nhật, bạn không cần tải lại.
      </p>
      <nav className="changelog-jump" aria-label="Chọn nền tảng">
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
                {entry.date && <time dateTime={entry.date}>{formatDate(entry.date)}</time>}
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
      <DownloadCta />
    </article>
  );
}
