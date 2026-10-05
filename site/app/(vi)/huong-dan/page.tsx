import { GuidesIndexPage } from '@/components/pages/GuidesIndexPage';
import { PATHS } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'vi',
  title: PAGE_TEXT.vi.guides.metaTitle,
  description: PAGE_TEXT.vi.guides.metaDescription,
  paths: PATHS.guides,
});

export default function Page() {
  return <GuidesIndexPage lang="vi" />;
}
