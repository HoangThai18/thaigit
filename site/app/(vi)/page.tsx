import { HomePage } from '@/components/pages/HomePage';
import { PATHS } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';
import { SITE_TEXT } from '@/lib/site';

export const metadata = pageMetadata({
  lang: 'vi',
  title: SITE_TEXT.vi.title,
  description: SITE_TEXT.vi.description,
  paths: PATHS.home,
});

export default function Page() {
  return <HomePage lang="vi" />;
}
