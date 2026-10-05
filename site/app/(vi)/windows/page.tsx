import { PlatformPage } from '@/components/PlatformPage';
import { PATHS } from '@/lib/i18n';
import { PLATFORM_TEXT } from '@/lib/platform-text';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  lang: 'vi',
  title: PLATFORM_TEXT.win.vi.metaTitle,
  description: PLATFORM_TEXT.win.vi.metaDescription,
  paths: PATHS.windows,
});

export default function Page() {
  return <PlatformPage lang="vi" os="win" />;
}
