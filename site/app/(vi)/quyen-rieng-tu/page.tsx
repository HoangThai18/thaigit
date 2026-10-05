import { PrivacyPage } from '@/components/pages/PrivacyPage';
import { PATHS } from '@/lib/i18n';
import { PAGE_TEXT } from '@/lib/page-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'vi',
  title: PAGE_TEXT.vi.privacy.metaTitle,
  description: PAGE_TEXT.vi.privacy.metaDescription,
  paths: PATHS.privacy,
});

export default function Page() {
  return <PrivacyPage lang="vi" />;
}
