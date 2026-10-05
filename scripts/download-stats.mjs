#!/usr/bin/env node
// Reports Thaigit download counts for the ADMIN (runs locally, needs `gh auth login`) by reading GitHub Releases' counters:
//   node scripts/download-stats.mjs            summary table
//   node scripts/download-stats.mjs --json     raw data (keep it around to compare day over day)
//
// How the counting works (numbers accumulate since the asset was uploaded; GitHub offers no per-day breakdown):
//  - macOS: Thaigit-macOS.zip = downloads from the homepage / release page; Thaigit-macOS-update.zip = self-updates (split
//    out from 1.1.1, older releases are lumped into Thaigit-macOS.zip); update.json = update checks (~4 per machine per
//    day) → an estimate of how many machines are in use.
//  - Windows: Thaigit-Windows-setup.exe (desktop-beta release) = downloads from the homepage; Thaigit_<v>_x64-setup.exe =
//    self-update or a manual download from the release page; latest.json = update checks.
// Per-day counts and per-running-app-version counts belong to the admin server on the VPS (plans/…/phase-07, item 7b).
import { execFileSync } from 'node:child_process';

const REPO = process.env.THAIGIT_REPO ?? 'HoangThai18/thaigit';

function releases() {
  const raw = execFileSync('gh', ['api', '--paginate', `repos/${REPO}/releases?per_page=100`], {
    encoding: 'utf8',
  });
  // --paginate concatenates adjacent JSON pages: "][" → ",".
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
const channels = all.filter((release) => ['desktop-stable', 'desktop-beta'].includes(release.tag_name));
const windows = {
  downloads: channels.reduce((sum, release) => sum + count(release, /^Thaigit-Windows-setup\.exe$/), 0),
  checks:
    channels.reduce((sum, release) => sum + count(release, /^latest\.json$/), 0) +
    win.reduce((sum, item) => sum + item.checks, 0),
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
