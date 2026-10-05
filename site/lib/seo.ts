import type { Metadata, Viewport } from 'next';
import { alternatesFor, OG_LOCALE, type Lang } from './i18n';
import { SITE, SITE_TEXT } from './site';

const OG_ALT: Record<Lang, string> = {
  vi: 'Thaigit — Git client trực quan, miễn phí cho macOS và Windows: kéo thả để merge, stage từng dòng, giải conflict vài cú bấm',
  en: 'Thaigit — a free, visual Git client for macOS and Windows: drag & drop to merge, stage lines, resolve conflicts in a few clicks',
};

const ogImage = (lang: Lang) => ({ url: `/og/${lang}.png`, width: 1200, height: 630, alt: OG_ALT[lang] });

export const ROOT_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0c111d' },
  ],
};

export function rootMetadata(lang: Lang): Metadata {
  const text = SITE_TEXT[lang];
  return {
    metadataBase: new URL(SITE.url),
    title: { default: text.title, template: '%s · Thaigit' },
    description: text.description,
    applicationName: SITE.name,
    keywords: text.keywords,
    authors: [{ name: SITE.author }],
    creator: SITE.author,
    publisher: SITE.author,
    category: 'technology',
    icons: { icon: '/icon.png', apple: '/apple-icon.png' },
    openGraph: {
      type: 'website',
      locale: OG_LOCALE[lang],
      alternateLocale: [OG_LOCALE[lang === 'vi' ? 'en' : 'vi']],
      siteName: SITE.name,
      title: text.title,
      description: text.description,
      images: [ogImage(lang)],
    },
    twitter: {
      card: 'summary_large_image',
      title: text.title,
      description: text.description,
      images: [ogImage(lang)],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export function pageMetadata({
  lang,
  title,
  description,
  paths,
  type = 'website',
  modifiedTime,
}: {
  lang: Lang;
  title: string;
  description: string;
  paths: Record<Lang, string>;
  type?: 'website' | 'article';
  modifiedTime?: string;
}): Metadata {
  const image = ogImage(lang);
  return {
    title: title.includes(SITE.name) ? { absolute: title } : title,
    description,
    alternates: { canonical: paths[lang], languages: alternatesFor(paths) },
    openGraph: {
      type,
      locale: OG_LOCALE[lang],
      alternateLocale: [OG_LOCALE[lang === 'vi' ? 'en' : 'vi']],
      siteName: SITE.name,
      url: paths[lang],
      title,
      description,
      images: [image],
      ...(type === 'article' && modifiedTime ? { modifiedTime } : {}),
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
