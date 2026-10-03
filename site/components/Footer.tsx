import Link from 'next/link';
import { LINKS, SITE } from '@/lib/site';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <strong style={{ color: 'var(--text)' }}>Thaigit</strong> — Git client trực quan, miễn phí.
          <br />© {new Date().getFullYear()} {SITE.author}
          <br />
          <small>
            Thaigit là dự án độc lập. Git và tên các sản phẩm khác được nhắc tới là nhãn hiệu của chủ sở hữu
            tương ứng.
          </small>
        </div>
        <nav className="footer-links" aria-label="Liên kết cuối trang">
          <a href={LINKS.github}>GitHub</a>
          <a href={LINKS.changelog}>Nhật ký thay đổi</a>
          <a href={LINKS.issues}>Báo lỗi / góp ý</a>
          <Link href="/quyen-rieng-tu/">Quyền riêng tư</Link>
        </nav>
      </div>
    </footer>
  );
}
