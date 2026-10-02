import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { thaigitDevBridge } from './dev/bridge-plugin.ts';

// Tauri chạy dev server cố định cổng 1420 (khai báo trong src-tauri/tauri.conf.json).
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // `thaigitDevBridge` chỉ chạy ở dev server (`apply: 'serve'`) và chỉ khi có THAIGIT_DEV_REPO: xem dev/bridge-plugin.ts.
  plugins: [svelte(), thaigitDevBridge()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 (Chromium) trên Windows, WKWebView trên macOS 11+.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
