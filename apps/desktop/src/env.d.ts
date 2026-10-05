/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** App version from package.json (vite.config.ts `define`); empty in tests. */
  readonly VITE_APP_VERSION?: string;
  /** AI / telemetry server (default https://git.thaipro.store) — change only for test builds pointing elsewhere. */
  readonly VITE_THAIGIT_API_URL?: string;
  /** Set by the Tauri CLI at build time: `windows` | `darwin` | … and `x86_64` | `aarch64` | …. */
  readonly TAURI_ENV_PLATFORM?: string;
  readonly TAURI_ENV_ARCH?: string;
}
