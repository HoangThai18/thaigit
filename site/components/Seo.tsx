import Link from 'next/link';
import { PATHS, type Lang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { UI } from '@/lib/ui';

export interface Crumb {
  name: string;
  path: string;
}

export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

export function Breadcrumbs({ lang, items }: { lang: Lang; items: Crumb[] }) {
  const text = UI[lang].crumbs;
  const all = [{ name: text.home, path: PATHS.home[lang] }, ...items];
  return (
    <>
      <nav className="crumbs" aria-label={text.aria}>
        <ol>
          {all.map((item, index) => (
            <li key={item.path}>
              {index < all.length - 1 ? (
                <Link href={item.path}>{item.name}</Link>
              ) : (
                <span aria-current="page">{item.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: all.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: `${SITE.url}${item.path}`,
          })),
        }}
      />
    </>
  );
}
