#!/usr/bin/env node
// Builds the `latest.json` manifest for the Windows updater (tauri-plugin-updater).
//   node scripts/desktop-latest-json.mjs <version> <tag> <file .exe> <file .sig> <CHANGELOG> > latest.json
// Release notes come from the "## <version>" section of CHANGELOG (plain text).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [version, tag, exePath, sigPath, changelogPath] = process.argv.slice(2);
if (!version || !tag || !exePath || !sigPath || !changelogPath) {
  console.error('Cách dùng: desktop-latest-json.mjs <phiên bản> <tag> <exe> <sig> <CHANGELOG>');
  process.exit(2);
}

const REPO = 'HoangThai18/thaigit';

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
const signature = readFileSync(sigPath, 'utf8').trim();
const asset = basename(exePath);
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`,
    },
  },
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
