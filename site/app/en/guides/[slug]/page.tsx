import { notFound } from 'next/navigation';
import { GuidePage } from '@/components/pages/GuidePage';
import { findGuide, GUIDES, guideSlug, guideText } from '@/lib/guides';
import { guidePath } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';

export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guideSlug('en', guide.id) }));
}

export async function generateMetadata({ params }: Props) {
  const guide = findGuide('en', (await params).slug);
  if (!guide) return {};
  const text = guideText('en', guide.id);
  return pageMetadata({
    lang: 'en',
    title: text.title,
    description: text.description,
    paths: { vi: guidePath('vi', guide.id), en: guidePath('en', guide.id) },
    type: 'article',
    modifiedTime: guide.updated,
  });
}

export default async function Page({ params }: Props) {
  const guide = findGuide('en', (await params).slug);
  if (!guide) notFound();
  return <GuidePage lang="en" guide={guide} />;
}
