import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { SITE } from './site';

const OG_ALT = readFileSync(path.join(process.cwd(), 'app', 'opengraph-image.alt.txt'), 'utf8').trim();

/**
 * Metadata cho trang con. `openGraph` của trang con thay hẳn (không gộp) bản ở layout, nên phải ghi lại ảnh chia sẻ,
 * tên trang, ngôn ngữ — thiếu ảnh thì Facebook / Zalo hiện link trơn.
 */
export function pageMetadata({
  title,
  description,
  path: pagePath,
  type = 'website',
  modifiedTime,
}: {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  modifiedTime?: string;
}): Metadata {
  const image = { url: '/opengraph-image.png', width: 1200, height: 630, alt: OG_ALT };
  return {
    // Tiêu đề đã có chữ "Thaigit" thì không thêm hậu tố "· Thaigit" của layout.
    title: title.includes(SITE.name) ? { absolute: title } : title,
    description,
    alternates: { canonical: pagePath },
    openGraph: {
      type,
      locale: 'vi_VN',
      siteName: SITE.name,
      url: pagePath,
      title,
      description,
      images: [image],
      ...(type === 'article' && modifiedTime ? { modifiedTime } : {}),
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
