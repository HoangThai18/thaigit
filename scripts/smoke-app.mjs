#!/usr/bin/env node
// Kiểm thử khói bản build (CI): mở app thật với THAIGIT_SMOKE_EXIT=1 — app tự thoát mã 0 khi giao diện dựng xong và gọi
// `app_ready` (xem src-tauri/src/safe_mode.rs). Không thoát trong thời hạn / thoát mã khác → lỗi.
//   node scripts/smoke-app.mjs apps/desktop/src-tauri/target/debug/thaigit
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const TIMEOUT_MS = 120_000;
let binary = process.argv[2];
if (!binary) {
  console.error('Cách dùng: node scripts/smoke-app.mjs <đường dẫn binary>');
  process.exit(2);
}
if (process.platform === 'win32' && !binary.endsWith('.exe')) binary += '.exe';
if (!existsSync(binary)) {
  console.error(`Không thấy binary: ${binary}`);
  process.exit(2);
}

const started = Date.now();
const child = spawn(binary, [], { env: { ...process.env, THAIGIT_SMOKE_EXIT: '1' }, stdio: 'inherit' });
const timer = setTimeout(() => {
  console.error(`✗ App không báo sẵn sàng trong ${TIMEOUT_MS / 1000} giây`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);
child.on('error', (error) => {
  clearTimeout(timer);
  console.error(`✗ Không chạy được app: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (code === 0) {
    console.log(`✓ App mở, giao diện báo sẵn sàng, thoát sạch sau ${seconds} giây`);
    process.exit(0);
  }
  console.error(`✗ App thoát mã ${code ?? signal} sau ${seconds} giây`);
  process.exit(1);
});
