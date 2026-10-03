import Link from 'next/link';

export function Header() {
  return (
    <header className="site-header glass">
      <div className="container">
        <Link className="brand" href="/" aria-label="Thaigit — trang chủ">
          <img src="/logo-96.png" width={34} height={34} alt="" />
          Thaigit
        </Link>
        <nav className="nav" aria-label="Mục chính">
          <a href="/#tinh-nang">Tính năng</a>
          <a href="/#tai-ve">Tải về</a>
          <a href="/#hoi-dap">Hỏi đáp</a>
        </nav>
        <div className="header-actions">
          <a className="btn btn-primary btn-small" href="/#tai-ve">
            Tải về
          </a>
        </div>
      </div>
    </header>
  );
}
