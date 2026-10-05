import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadCta } from '@/components/DownloadCta';
import { Breadcrumbs, JsonLd } from '@/components/Seo';
import { GUIDES } from '@/lib/guides';
import { SITE } from '@/lib/site';
import { pageMetadata } from '@/lib/seo';

const TITLE = 'Hướng dẫn Git cho người mới — dễ hiểu, có hình';
const DESCRIPTION =
  'Các bài hướng dẫn Git bằng tiếng Việt: giải conflict, stage từng dòng, hoàn tác commit, merge và rebase, git stash, cài đặt Git — kèm lệnh và cách làm trực quan bằng Thaigit.';

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/huong-dan/',
});

export default function GuidesPage() {
  return (
    <article className="prose wide container">
      <Breadcrumbs items={[{ name: 'Hướng dẫn', path: '/huong-dan/' }]} />
      <h1>Hướng dẫn Git</h1>
      <p className="lead">
        Những việc hay gặp khi làm việc với Git, giải thích ngắn gọn bằng tiếng Việt. Mỗi bài có lệnh git để
        làm trên Terminal và cách làm bằng vài cú bấm trong Thaigit.
      </p>
      <ul className="guide-grid">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link className="guide-card" href={`/huong-dan/${guide.slug}/`}>
              <strong>{guide.short}</strong>
              <span>{guide.description}</span>
              <small>{guide.minutes} phút đọc</small>
            </Link>
          </li>
        ))}
      </ul>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: GUIDES.map((guide, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${SITE.url}/huong-dan/${guide.slug}/`,
            name: guide.title,
          })),
        }}
      />
      <DownloadCta />
    </article>
  );
}
