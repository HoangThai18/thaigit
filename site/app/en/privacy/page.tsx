import { PrivacyPage } from '@/components/pages/PrivacyPage';
import { PATHS } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'en',
  title: PAGE_TEXT.en.privacy.metaTitle,
  description: PAGE_TEXT.en.privacy.metaDescription,
  paths: PATHS.privacy,
});

export default function Page() {
  return <PrivacyPage lang="en" />;
}
