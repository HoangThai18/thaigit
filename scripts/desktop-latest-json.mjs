#!/usr/bin/env node
// Builds the `latest.json` manifest for the updater (tauri-plugin-updater) — one manifest can carry several platforms
// (`windows-x86_64`, `darwin-aarch64`…); each platform updates from its own asset.
//   node scripts/desktop-latest-json.mjs <version> <tag> <CHANGELOG> [--windows <exe> <sig>] [--darwin-aarch64 <tgz> <sig>] [--darwin-x86_64 <tgz> <sig>] > latest.json
// Release notes come from the "## <version>" section of CHANGELOG (plain text).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    'Cách dùng: desktop-latest-json.mjs <phiên bản> <tag> <CHANGELOG> [--windows <exe> <sig>] [--darwin-aarch64 <tgz> <sig>] [--darwin-x86_64 <tgz> <sig>]',
  );
  process.exit(2);
}
const [version, tag, changelogPath] = args;
const rest = args.slice(3);
const REPO = 'HoangThai18/thaigit';
const PLATFORM_FLAGS = {
  '--windows': 'windows-x86_64',
  '--darwin-aarch64': 'darwin-aarch64',
  '--darwin-x86_64': 'darwin-x86_64',
};
const platforms = {};
for (let i = 0; i < rest.length; i += 3) {
  const flag = rest[i];
  const key = PLATFORM_FLAGS[flag];
  const assetPath = rest[i + 1];
  const sigPath = rest[i + 2];
  if (!key || !assetPath || !sigPath) {
    console.error(`Cặp tham số không hợp lệ quanh "${rest[i]}" — kỳ vọng --<nền> <file> <sig>`);
    process.exit(2);
  }
  const signature = readFileSync(sigPath, 'utf8').trim();
  const asset = basename(assetPath);
  platforms[key] = {
    signature,
    url: `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`,
  };
}
if (Object.keys(platforms).length === 0) {
  console.error('Cần ít nhất một nền tảng, vd. --windows <exe> <sig>');
  process.exit(2);
}

export function releaseNotes(changelog, wanted) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.startsWith('## ') && line.slice(3).split(' ')[0] === wanted);
  if (start < 0) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

const notes = releaseNotes(readFileSync(changelogPath, 'utf8'), version);
if (notes === null) {
  console.error(`CHANGELOG chưa có mục "## ${version}"`);
  process.exit(1);
}
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
