import type { MetadataRoute } from 'next';
import { GUIDES } from '@/lib/guides';
import { SITE } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE.url}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE.url}/mac/`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/windows/`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE.url}/huong-dan/`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ...GUIDES.map((guide) => ({
      url: `${SITE.url}/huong-dan/${guide.slug}/`,
      lastModified: new Date(guide.updated),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: `${SITE.url}/nhat-ky/`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE.url}/quyen-rieng-tu/`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
