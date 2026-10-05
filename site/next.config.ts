import type { NextConfig } from 'next';

// Static export (pre-rendered HTML — good for SEO): `next build` → the out/ directory, deployable to GitHub Pages, a VPS or Vercel.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { globalNotFound: true },
};

export default config;
