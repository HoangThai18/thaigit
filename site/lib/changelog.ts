import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Platform = 'macOS' | 'Windows';

export interface ChangelogItem {
  title: string;
  detail: string;
}

export interface ChangelogEntry {
  platform: Platform;
  version: string;
  date: string;
  summary: string;
  items: ChangelogItem[];
}

// Một mã nguồn duy nhất: bản đa nền tảng dùng chung nhật ký cho cả Windows lẫn macOS.
const SOURCES: readonly { platform: Platform; file: string }[] = [
  { platform: 'Windows', file: path.join('..', 'apps', 'desktop', 'CHANGELOG.md') },
  { platform: 'macOS', file: path.join('..', 'apps', 'desktop', 'CHANGELOG.md') },
];

const AI_MENTION = /\bAI\b|Apple Intelligence|Hermes/;

const TITLE_MAX = 64;
const DETAIL_MAX = 110;

function dropParentheses(text: string): string {
  let depth = 0;
  let out = '';
  for (const char of text) {
    if (char === '(') {
      if (depth === 0) out = out.trimEnd();
      depth += 1;
    } else if (char === ')' && depth > 0) depth -= 1;
    else if (depth === 0) out += char;
  }
  return out
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function breakAt(text: string, separators: RegExp): number {
  separators.lastIndex = 0;
  for (let match = separators.exec(text); match; match = separators.exec(text)) {
    const quotes = (text.slice(0, match.index).match(/"/g) ?? []).length;
    if (quotes % 2 === 0) return match.index;
  }
  return -1;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const comma = cut.lastIndexOf(', ');
  if (comma > max * 0.5) return cut.slice(0, comma);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

export function condense(line: string): ChangelogItem {
  const text = dropParentheses(line.replace(/`/g, '').replace(/;\s*$/, ''));
  const colon = breakAt(text, /:\s/g);
  const head = colon > 0 ? text.slice(0, colon) : text;
  const rest = colon > 0 ? text.slice(colon + 1).trim() : '';
  const end = breakAt(rest, /;\s|\s—\s/g);
  const first = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return {
    title: clip(head, TITLE_MAX),
    detail: first === '' ? '' : clip(first.charAt(0).toUpperCase() + first.slice(1), DETAIL_MAX),
  };
}

function parse(text: string, platform: Platform): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(\S+)(?:\s+[—–-]\s+(.*))?$/.exec(line);
    if (heading) {
      const version = heading[1] ?? '';
      current = /^\d/.test(version)
        ? { platform, version, date: heading[2] ?? '', summary: '', items: [] }
        : null;
      if (current) entries.push(current);
      continue;
    }
    if (!current || !line) continue;
    if (line.startsWith('- ')) {
      const item = condense(line.slice(2));
      if (!AI_MENTION.test(item.title)) {
        current.items.push({ ...item, detail: item.detail.replace(/,\s*AI(?=,)/g, '') });
      }
    } else if (!current.summary) current.summary = line;
  }
  return entries;
}

export interface ChangelogLane {
  platform: Platform;
  entries: ChangelogEntry[];
}

export async function readChangelog(limit = 3): Promise<ChangelogLane[]> {
  const lanes: ChangelogLane[] = [];
  for (const platform of ['macOS', 'Windows'] as const) {
    const source = SOURCES.find((item) => item.platform === platform);
    if (!source) continue;
    try {
      const text = await readFile(path.join(process.cwd(), source.file), 'utf8');
      const entries = parse(text, platform)
        .filter((entry) => !entry.version.includes('-'))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);
      if (entries.length > 0) lanes.push({ platform, entries });
    } catch {
      // A missing file just skips that version.
    }
  }
  return lanes;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: string, lang: 'vi' | 'en' = 'vi'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  if (lang === 'en') return `${MONTHS_EN[Number(match[2]) - 1] ?? match[2]} ${Number(match[3])}, ${match[1]}`;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
