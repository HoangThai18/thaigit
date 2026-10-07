#!/usr/bin/env node
// Reports Thaigit download counts for the ADMIN (runs locally, needs `gh auth login`) by reading GitHub Releases' counters:
//   node scripts/download-stats.mjs            summary table
//   node scripts/download-stats.mjs --json     raw data (keep it around to compare day over day)
//
// How the counting works (numbers accumulate since the asset was uploaded; GitHub offers no per-day breakdown):
//  - macOS (bản đa nền tảng, tag desktop-v*): Thaigit-macOS.dmg (desktop-stable/beta release) = downloads from the
//    homepage; Thaigit_<v>_aarch64.app.tar.gz = self-update or manual download; Thaigit_<v>_aarch64.dmg = manual download
//    from the release page. Lịch sử bản macOS Swift (tag v*): Thaigit-macOS.zip.
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
const macLegacy = all
  .filter((release) => /^v\d/.test(release.tag_name))
  .map((release) => ({
    version: release.tag_name.slice(1),
    published: release.published_at,
    downloads: count(release, /^Thaigit-macOS\.zip$/),
  }));
const mac = all
  .filter((release) => release.tag_name.startsWith('desktop-v'))
  .map((release) => ({
    version: release.tag_name.slice('desktop-v'.length),
    published: release.published_at,
    downloads: count(release, /^Thaigit_.*_aarch64\.dmg$/),
    updates: count(release, /^Thaigit_.*_aarch64\.app\.tar\.gz$/),
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
    downloads:
      sum(macLegacy, 'downloads') +
      sum(mac, 'downloads') +
      channels.reduce((s2, r) => s2 + count(r, /^Thaigit-macOS\.dmg$/), 0),
    updates: sum(mac, 'updates'),
    checks: channels.reduce((s2, r) => s2 + count(r, /^latest\.json$/), 0),
    versions: [...macLegacy.map((m) => ({ ...m, updates: 0 })), ...mac],
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
line('Tự cập nhật (app.tar.gz)', result.macos.updates);
line('Lượt kiểm cập nhật (≈ 4 lần/máy/ngày)', result.macos.checks);
for (const item of result.macos.versions) {
  console.log(
    `    v${item.version.padEnd(14)} tải mới ${pad(item.downloads, 6)} · cập nhật ${pad(item.updates, 6)}`,
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
