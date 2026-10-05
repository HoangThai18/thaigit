import Link from 'next/link';
import { SITE } from '@/lib/site';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-brand">
          <img src="/logo-96.png" width={28} height={28} alt="" />
          <div>
            <strong>Thaigit</strong> — Git client trực quan, miễn phí.
            <br />© {new Date().getFullYear()} {SITE.author}
            <small>
              Thaigit là dự án độc lập. Git và tên các sản phẩm khác được nhắc tới là nhãn hiệu của chủ sở hữu
              tương ứng.
            </small>
          </div>
        </div>
        <nav className="footer-links" aria-label="Liên kết cuối trang">
          <Link href="/mac/">Thaigit cho macOS</Link>
          <Link href="/windows/">Thaigit cho Windows</Link>
          <Link href="/huong-dan/">Hướng dẫn Git</Link>
          <Link href="/nhat-ky/">Nhật ký thay đổi</Link>
          <Link href="/quyen-rieng-tu/">Quyền riêng tư</Link>
        </nav>
      </div>
    </footer>
  );
}
