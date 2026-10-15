// File-type badges for file lists (like an editor's file icons): a short label on a brand-ish colour per language / format,
// or a small glyph for kinds a label can't say (images, lock files…). Decided from the file name only.

export type FileGlyph = 'image' | 'lock' | 'doc';

export interface FileType {
  /** Up to 3 characters drawn on the badge; empty when `glyph` is drawn instead. */
  readonly label: string;
  readonly glyph?: FileGlyph;
  readonly color: string;
  /** Text colour on light badges (yellow…); white otherwise. */
  readonly ink: string;
}

const DARK = '#1d1d1f';
const WHITE = '#ffffff';

const t = (label: string, color: string, ink = WHITE): FileType => ({ label, color, ink });
const g = (glyph: FileGlyph, color: string): FileType => ({ label: '', glyph, color, ink: WHITE });

const BY_NAME: Readonly<Record<string, FileType>> = {
  dockerfile: t('DK', '#2496ed'),
  makefile: t('MK', '#6d8086'),
  license: t('LIC', '#b8962e'),
  'license.md': t('LIC', '#b8962e'),
  '.gitignore': t('GIT', '#f05032'),
  '.gitattributes': t('GIT', '#f05032'),
  '.gitmodules': t('GIT', '#f05032'),
  '.editorconfig': t('CFG', '#6d8086'),
  '.env': t('ENV', '#ecd53f', DARK),
  '.nvmrc': t('NOD', '#5fa04e'),
  'package-lock.json': g('lock', '#8e8e93'),
  'pnpm-lock.yaml': g('lock', '#8e8e93'),
  'yarn.lock': g('lock', '#8e8e93'),
  'cargo.lock': g('lock', '#8e8e93'),
  'composer.lock': g('lock', '#8e8e93'),
  'gemfile.lock': g('lock', '#8e8e93'),
  'package.json': t('NPM', '#cb3837'),
  'cargo.toml': t('RS', '#dea584', DARK),
  'composer.json': t('PHP', '#777bb4'),
};

const BY_EXTENSION: Readonly<Record<string, FileType>> = {
  ts: t('TS', '#3178c6'),
  tsx: t('TSX', '#3178c6'),
  mts: t('TS', '#3178c6'),
  cts: t('TS', '#3178c6'),
  js: t('JS', '#f0c419', DARK),
  jsx: t('JSX', '#f0c419', DARK),
  mjs: t('JS', '#f0c419', DARK),
  cjs: t('JS', '#f0c419', DARK),
  vue: t('VUE', '#42b883'),
  svelte: t('SV', '#ff3e00'),
  php: t('PHP', '#777bb4'),
  py: t('PY', '#3776ab'),
  rb: t('RB', '#cc342d'),
  go: t('GO', '#00add8'),
  rs: t('RS', '#dea584', DARK),
  java: t('JV', '#e76f00'),
  kt: t('KT', '#7f52ff'),
  kts: t('KT', '#7f52ff'),
  swift: t('SW', '#f05138'),
  c: t('C', '#5c6bc0'),
  h: t('H', '#8e8e93'),
  cc: t('C++', '#00599c'),
  cpp: t('C++', '#00599c'),
  hpp: t('H++', '#00599c'),
  cs: t('C#', '#68217a'),
  dart: t('DT', '#0175c2'),
  lua: t('LUA', '#000080'),
  sh: t('SH', '#4eaa25'),
  bash: t('SH', '#4eaa25'),
  zsh: t('SH', '#4eaa25'),
  ps1: t('PS', '#2c5591'),
  bat: t('BAT', '#4d4d4d'),
  sql: t('SQL', '#e38c00'),
  html: t('<>', '#e34f26'),
  htm: t('<>', '#e34f26'),
  css: t('CSS', '#1572b6'),
  scss: t('SC', '#c6538c'),
  sass: t('SC', '#c6538c'),
  less: t('LS', '#1d365d'),
  json: t('{}', '#cbcb41', DARK),
  jsonc: t('{}', '#cbcb41', DARK),
  yaml: t('YML', '#cb171e'),
  yml: t('YML', '#cb171e'),
  toml: t('TML', '#9c4221'),
  ini: t('INI', '#6d8086'),
  xml: t('XML', '#0060ac'),
  plist: t('XML', '#0060ac'),
  md: t('MD', '#519aba'),
  mdx: t('MDX', '#519aba'),
  txt: t('TXT', '#8e8e93'),
  log: t('LOG', '#8e8e93'),
  csv: t('CSV', '#1d6f42'),
  pdf: t('PDF', '#e5252a'),
  svg: t('SVG', '#ffb13b', DARK),
  png: g('image', '#a259ff'),
  jpg: g('image', '#a259ff'),
  jpeg: g('image', '#a259ff'),
  gif: g('image', '#a259ff'),
  webp: g('image', '#a259ff'),
  avif: g('image', '#a259ff'),
  bmp: g('image', '#a259ff'),
  ico: g('image', '#a259ff'),
  icns: g('image', '#a259ff'),
  ttf: t('Aa', '#6b7280'),
  otf: t('Aa', '#6b7280'),
  woff: t('Aa', '#6b7280'),
  woff2: t('Aa', '#6b7280'),
  zip: t('ZIP', '#8d6e63'),
  gz: t('ZIP', '#8d6e63'),
  tgz: t('ZIP', '#8d6e63'),
  tar: t('ZIP', '#8d6e63'),
  rar: t('ZIP', '#8d6e63'),
  '7z': t('ZIP', '#8d6e63'),
  lock: g('lock', '#8e8e93'),
  env: t('ENV', '#ecd53f', DARK),
};

const GENERIC = g('doc', '#8e8e93');

export function fileTypeOf(path: string): FileType {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  const known = BY_NAME[name];
  if (known) return known;
  if (name.startsWith('.env.')) return BY_EXTENSION.env ?? GENERIC;
  if (name.endsWith('.blade.php')) return t('BLD', '#f05340');
  if (name.endsWith('.d.ts')) return t('DTS', '#3178c6');
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return GENERIC;
  return BY_EXTENSION[name.slice(dot + 1)] ?? GENERIC;
}
