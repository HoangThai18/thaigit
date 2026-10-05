import Link from 'next/link';
import { SITE } from '@/lib/site';

export interface Crumb {
  name: string;
  path: string;
}

/** Dữ liệu có cấu trúc (schema.org) cho công cụ tìm kiếm. */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** Đường dẫn "Trang chủ / … / trang này" — hiện trên trang và gửi kèm BreadcrumbList cho Google. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all = [{ name: 'Trang chủ', path: '/' }, ...items];
  return (
    <>
      <nav className="crumbs" aria-label="Vị trí trang">
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
