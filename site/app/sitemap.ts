import type { MetadataRoute } from 'next';
import { GUIDES } from '@/lib/guides';
import { alternatesFor, guidePath, LANGS, PATHS, type PageKey } from '@/lib/i18n';
import { SITE } from '@/lib/site';

export const dynamic = 'force-static';

const PAGES: { key: PageKey; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[] = [
  { key: 'home', changeFrequency: 'weekly', priority: 1 },
  { key: 'mac', changeFrequency: 'monthly', priority: 0.9 },
  { key: 'windows', changeFrequency: 'monthly', priority: 0.9 },
  { key: 'guides', changeFrequency: 'weekly', priority: 0.8 },
  { key: 'changelog', changeFrequency: 'weekly', priority: 0.6 },
  { key: 'privacy', changeFrequency: 'yearly', priority: 0.3 },
];

const absolute = (paths: Record<string, string>) =>
  Object.fromEntries(Object.entries(paths).map(([lang, path]) => [lang, `${SITE.url}${path}`]));

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = PAGES.flatMap(({ key, changeFrequency, priority }) =>
    LANGS.map((lang) => ({
      url: `${SITE.url}${PATHS[key][lang]}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: absolute(alternatesFor(PATHS[key])) },
    })),
  );
  const guides = GUIDES.flatMap((guide) =>
    LANGS.map((lang) => ({
      url: `${SITE.url}${guidePath(lang, guide.id)}`,
      lastModified: new Date(guide.updated),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
      alternates: {
        languages: absolute(alternatesFor({ vi: guidePath('vi', guide.id), en: guidePath('en', guide.id) })),
      },
    })),
  );
  return [...pages, ...guides];
}
