/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Phiên bản app từ package.json (vite.config.ts `define`); rỗng trong test. */
  readonly VITE_APP_VERSION?: string;
  /** Máy chủ AI / thống kê (mặc định https://git.thaipro.store) — chỉ đổi cho bản build thử với máy chủ khác. */
  readonly VITE_THAIGIT_API_URL?: string;
}
