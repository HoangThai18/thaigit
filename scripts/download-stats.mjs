#!/usr/bin/env node
// Thống kê lượt tải Thaigit cho ADMIN (chạy ở máy, cần `gh auth login`) — đọc số đếm của GitHub Releases:
//   node scripts/download-stats.mjs            bảng tóm tắt
//   node scripts/download-stats.mjs --json     dữ liệu thô (để lưu lại so sánh theo ngày)
//
// Cách đếm (số cộng dồn từ lúc đăng file, GitHub không cho theo ngày):
//  - macOS: Thaigit-macOS.zip = tải từ trang chủ / trang release; Thaigit-macOS-update.zip = app tự cập nhật (tách từ 1.1.1,
//    bản cũ hơn gộp chung vào Thaigit-macOS.zip); update.json = lượt app kiểm cập nhật (mỗi máy ~4 lần/ngày) → ước lượng
//    số máy đang dùng.
//  - Windows: Thaigit-Windows-setup.exe (release desktop-beta) = tải từ trang chủ; Thaigit_<v>_x64-setup.exe = app tự cập
//    nhật hoặc tải tay từ trang release; latest.json = lượt app kiểm cập nhật.
// Đếm theo ngày, theo phiên bản app đang chạy… thuộc máy chủ admin trên VPS (plans/…/phase-07, mục 7b).
import { execFileSync } from 'node:child_process';

const REPO = process.env.THAIGIT_REPO ?? 'HoangThai18/thaigit';

function releases() {
  const raw = execFileSync('gh', ['api', '--paginate', `repos/${REPO}/releases?per_page=100`], {
    encoding: 'utf8',
  });
  // --paginate nối các trang JSON liền nhau: "][" → ",".
  return JSON.parse(raw.replace(/\]\s*\[/g, ','));
}

function count(release, name) {
  return release.assets
    .filter((asset) => name.test(asset.name))
    .reduce((sum, asset) => sum + asset.download_count, 0);
}

const all = releases();
const mac = all
  .filter((release) => /^v\d/.test(release.tag_name))
  .map((release) => ({
    version: release.tag_name.slice(1),
    published: release.published_at,
    downloads: count(release, /^Thaigit-macOS\.zip$/),
    updates: count(release, /^Thaigit-macOS-update\.zip$/),
    checks: count(release, /^update\.json$/),
  }));
const win = all
  .filter((release) => release.tag_name.startsWith('desktop-v'))
  .map((release) => ({
    version: release.tag_name.slice('desktop-v'.length),
    published: release.published_at,
    installers: count(release, /^Thaigit_.*_x64-setup\.exe$/),
    checks: count(release, /^latest\.json$/),
  }));
const beta = all.find((release) => release.tag_name === 'desktop-beta');
const windows = {
  downloads: beta ? count(beta, /^Thaigit-Windows-setup\.exe$/) : 0,
  checks: (beta ? count(beta, /^latest\.json$/) : 0) + win.reduce((sum, item) => sum + item.checks, 0),
  versions: win,
};
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const result = {
  generatedAt: new Date().toISOString(),
  macos: {
    downloads: sum(mac, 'downloads'),
    updates: sum(mac, 'updates'),
    checks: sum(mac, 'checks'),
    versions: mac,
  },
  windows: { ...windows, installers: sum(win, 'installers') },
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

const pad = (value, width) => String(value).padStart(width);
const line = (label, value) => console.log(`  ${label.padEnd(50)}${pad(value, 8)}`);
console.log(`Thống kê lượt tải Thaigit — ${new Date().toLocaleString('vi-VN')}\n`);
console.log('macOS');
line('Tải mới (trang chủ / trang release)', result.macos.downloads);
line('Tự cập nhật (từ 1.1.1)', result.macos.updates);
line('Lượt kiểm cập nhật (≈ 4 lần/máy/ngày)', result.macos.checks);
for (const item of mac) {
  console.log(
    `    v${item.version.padEnd(14)} tải mới ${pad(item.downloads, 6)} · cập nhật ${pad(item.updates, 6)} · kiểm ${pad(item.checks, 7)}`,
  );
}
console.log('\nWindows');
line('Tải mới từ trang chủ (Thaigit-Windows-setup.exe)', result.windows.downloads);
line('Bản cài theo phiên bản (tự cập nhật + tải tay)', result.windows.installers);
line('Lượt kiểm cập nhật (≈ 4 lần/máy/ngày)', result.windows.checks);
for (const item of win) {
  console.log(
    `    ${item.version.padEnd(15)} bản cài ${pad(item.installers, 6)} · kiểm ${pad(item.checks, 7)}`,
  );
}
