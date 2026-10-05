// Syntax highlighting for diffs (like GitKraken): refractor (Prism's grammars) returns a token TREE, not an
// HTML string — every piece is rendered as plain text inside a <span class>, so no `{@html}` is needed.
// Highlighting runs line by line (a diff only has disjoint hunks), so multi-line strings / comments can come
// out slightly wrong — acceptable, and true of most diff tools.

import { refractor } from 'refractor/lib/core.js';
import bash from 'refractor/lang/bash.js';
import batch from 'refractor/lang/batch.js';
import c from 'refractor/lang/c.js';
import cpp from 'refractor/lang/cpp.js';
import csharp from 'refractor/lang/csharp.js';
import css from 'refractor/lang/css.js';
import dart from 'refractor/lang/dart.js';
import docker from 'refractor/lang/docker.js';
import go from 'refractor/lang/go.js';
import ini from 'refractor/lang/ini.js';
import java from 'refractor/lang/java.js';
import javascript from 'refractor/lang/javascript.js';
import json from 'refractor/lang/json.js';
import jsx from 'refractor/lang/jsx.js';
import kotlin from 'refractor/lang/kotlin.js';
import lua from 'refractor/lang/lua.js';
import markdown from 'refractor/lang/markdown.js';
import markup from 'refractor/lang/markup.js';
import php from 'refractor/lang/php.js';
import powershell from 'refractor/lang/powershell.js';
import python from 'refractor/lang/python.js';
import ruby from 'refractor/lang/ruby.js';
import rust from 'refractor/lang/rust.js';
import scss from 'refractor/lang/scss.js';
import sql from 'refractor/lang/sql.js';
import swift from 'refractor/lang/swift.js';
import toml from 'refractor/lang/toml.js';
import tsx from 'refractor/lang/tsx.js';
import typescript from 'refractor/lang/typescript.js';
import yaml from 'refractor/lang/yaml.js';

for (const syntax of [
  bash,
  batch,
  c,
  cpp,
  csharp,
  css,
  dart,
  docker,
  go,
  ini,
  java,
  javascript,
  json,
  jsx,
  kotlin,
  lua,
  markdown,
  markup,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  yaml,
]) {
  refractor.register(syntax);
}

const BY_EXTENSION: Readonly<Record<string, string>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  svelte: 'component',
  vue: 'component',
  plist: 'markup',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  lua: 'lua',
  dart: 'dart',
};

const BY_NAME: Readonly<Record<string, string>> = {
  dockerfile: 'docker',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
};

/** Language (refractor name) for a file path; `null` = no highlighting. */
export function languageFor(path: string): string | null {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/** One piece of a line's text plus its token kind (`keyword`, `string`…; `null` = plain text). */
export interface SyntaxToken {
  readonly text: string;
  readonly type: string | null;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function tokenType(node: HastNode, inherited: string | null): string | null {
  const names = node.properties?.className;
  if (!Array.isArray(names)) return inherited;
  const specific = names.filter((name): name is string => typeof name === 'string' && name !== 'token');
  return specific[0] ?? inherited;
}

function flatten(node: HastNode, type: string | null, out: SyntaxToken[]): void {
  if (node.type === 'text') {
    const text = node.value ?? '';
    if (text === '') return;
    const last = out.at(-1);
    if (last && last.type === type) out[out.length - 1] = { text: last.text + text, type };
    else out.push({ text, type });
    return;
  }
  const own = node.type === 'element' ? tokenType(node, type) : type;
  for (const child of node.children ?? []) flatten(child, own, out);
}

const MAX_LINE = 2000;
const CACHE_LIMIT = 20_000;
const cache = new Map<string, readonly SyntaxToken[]>();

/** Component files (Svelte / Vue): a line starting with a tag is highlighted as markup, the rest (script, expressions) as TypeScript. */
const COMPONENT_TAG_LINE = /^\s*<\/?[A-Za-z!]/;

/** Tokens of one line (memoised). A very long line or an unknown language → a single plain-text piece. */
export function tokenizeLine(text: string, requested: string | null): readonly SyntaxToken[] {
  const language =
    requested === 'component' ? (COMPONENT_TAG_LINE.test(text) ? 'markup' : 'typescript') : requested;
  if (language === null || text.length > MAX_LINE || !refractor.registered(language))
    return [{ text, type: null }];
  const key = `${language}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let tokens: SyntaxToken[] = [];
  try {
    flatten(refractor.highlight(text, language) as unknown as HastNode, null, tokens);
  } catch {
    tokens = [{ text, type: null }];
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, tokens);
  return tokens;
}

/** The pieces to draw: syntax tokens, further split at intra-line change boundaries (`<mark>`). */
export interface LineSegment {
  readonly text: string;
  readonly type: string | null;
  readonly marked: boolean;
}

export function lineSegments(
  tokens: readonly SyntaxToken[],
  highlight: { readonly start: number; readonly end: number } | null | undefined,
): LineSegment[] {
  const segments: LineSegment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;
    if (!highlight || highlight.end <= start || highlight.start >= end) {
      segments.push({ text: token.text, type: token.type, marked: false });
      continue;
    }
    const from = Math.max(highlight.start, start) - start;
    const to = Math.min(highlight.end, end) - start;
    if (from > 0) segments.push({ text: token.text.slice(0, from), type: token.type, marked: false });
    segments.push({ text: token.text.slice(from, to), type: token.type, marked: true });
    if (to < token.text.length)
      segments.push({ text: token.text.slice(to), type: token.type, marked: false });
  }
  return segments;
}
