import { ChangelogPage } from '@/components/pages/ChangelogPage';
import { PATHS } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'en',
  title: PAGE_TEXT.en.changelog.metaTitle,
  description: PAGE_TEXT.en.changelog.metaDescription,
  paths: PATHS.changelog,
});

export default function Page() {
  return <ChangelogPage lang="en" />;
}
