import { ChangelogPage } from '@/components/pages/ChangelogPage';
import { PATHS } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'vi',
  title: PAGE_TEXT.vi.changelog.metaTitle,
  description: PAGE_TEXT.vi.changelog.metaDescription,
  paths: PATHS.changelog,
});

export default function Page() {
  return <ChangelogPage lang="vi" />;
}
