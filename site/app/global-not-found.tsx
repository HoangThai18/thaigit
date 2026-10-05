import { RootShell } from '@/components/RootShell';
import { NotFoundPage } from '@/components/pages/NotFoundPage';
import { rootMetadata } from '@/lib/seo';

export const metadata = {
  ...rootMetadata('vi'),
  title: 'Không tìm thấy trang · Page not found',
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  return (
    <RootShell lang="vi">
      <NotFoundPage lang="vi" />
    </RootShell>
  );
}
