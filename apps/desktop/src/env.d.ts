/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Phiên bản app từ package.json (vite.config.ts `define`); rỗng trong test. */
  readonly VITE_APP_VERSION?: string;
}
