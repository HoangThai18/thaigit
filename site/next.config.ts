import type { NextConfig } from 'next';

// Xuất trang tĩnh (HTML dựng sẵn — tốt cho SEO): `next build` → thư mục out/, đặt ở GitHub Pages, VPS hay Vercel.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
