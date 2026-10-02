import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Không tìm thấy trang',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="prose container" style={{ textAlign: 'center', paddingBottom: 40 }}>
      <h1>Không tìm thấy trang</h1>
      <p>Trang bạn tìm không có hoặc đã được chuyển đi.</p>
      <p>
        <Link className="btn btn-primary" href="/">
          Về trang chủ
        </Link>
      </p>
    </section>
  );
}
