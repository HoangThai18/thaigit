import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Platform = 'macOS' | 'Windows';

export interface ChangelogItem {
  /** Tên tính năng (phần trước dấu ":" của dòng, bỏ chú thích trong ngoặc). */
  title: string;
  /** Một câu mô tả ngắn (đã rút gọn); rỗng nếu dòng chỉ có tên. */
  detail: string;
}

export interface ChangelogEntry {
  platform: Platform;
  version: string;
  /** `YYYY-MM-DD` như trong file. */
  date: string;
  summary: string;
  items: ChangelogItem[];
}

const SOURCES: readonly { platform: Platform; file: string }[] = [
  { platform: 'Windows', file: path.join('..', 'apps', 'desktop', 'CHANGELOG.md') },
  { platform: 'macOS', file: path.join('..', 'CHANGELOG.md') },
];

/** Tính năng AI (đang tạm tắt) — không đưa lên trang. */
const AI_MENTION = /\bAI\b|Apple Intelligence|Hermes/;

/** Độ dài tối đa của tên và câu mô tả hiện trên trang (nhật ký gốc viết rất chi tiết cho người dùng app). */
const TITLE_MAX = 64;
const DETAIL_MAX = 110;

/** Bỏ chú thích trong ngoặc tròn (phím tắt, ví dụ, chi tiết kỹ thuật) — trang chủ chỉ cần ý chính. */
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

/** Vị trí đầu tiên của một trong các dấu ngắt nằm ngoài ngoặc kép; -1 nếu không có. */
function breakAt(text: string, separators: RegExp): number {
  separators.lastIndex = 0;
  for (let match = separators.exec(text); match; match = separators.exec(text)) {
    const quotes = (text.slice(0, match.index).match(/"/g) ?? []).length;
    if (quotes % 2 === 0) return match.index;
  }
  return -1;
}

/** Rút gọn tới `max` ký tự: ưu tiên dừng ở dấu phẩy (trọn ý, không cần "…"), không thì cắt ở ranh giới từ + "…". */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const comma = cut.lastIndexOf(', ');
  if (comma > max * 0.5) return cut.slice(0, comma);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** "Tên (chú thích): chi tiết; chi tiết nữa" → `{ title: 'Tên', detail: 'Chi tiết' }`. */
export function condense(line: string): ChangelogItem {
  const text = dropParentheses(line.replace(/`/g, '').replace(/;\s*$/, ''));
  const colon = breakAt(text, /:\s/g);
  const head = colon > 0 ? text.slice(0, colon) : text;
  const rest = colon > 0 ? text.slice(colon + 1).trim() : '';
  // Câu đầu tiên của phần chi tiết: dừng ở ";" hoặc " — " (phần sau thường là chi tiết kỹ thuật).
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
      // "## Chưa phát hành" chưa ra mắt: không đưa lên trang.
      current = /^\d/.test(version)
        ? { platform, version, date: heading[2] ?? '', summary: '', items: [] }
        : null;
      if (current) entries.push(current);
      continue;
    }
    if (!current || !line) continue;
    if (line.startsWith('- ')) {
      const item = condense(line.slice(2));
      // Tính năng AI đang tạm tắt trong app: chưa giới thiệu trên trang.
      if (!AI_MENTION.test(item.title)) {
        current.items.push({ ...item, detail: item.detail.replace(/,\s*AI(?=,)/g, '') });
      }
    } else if (!current.summary) current.summary = line;
  }
  return entries;
}

/**
 * Đọc nhật ký của cả hai bản lúc build (`CHANGELOG.md` của macOS, `apps/desktop/CHANGELOG.md` của Windows), bỏ bản thử
 * `-beta`, xếp mới nhất lên trước.
 */
export async function readChangelog(limit = 3): Promise<ChangelogEntry[]> {
  const all: ChangelogEntry[] = [];
  for (const source of SOURCES) {
    try {
      const text = await readFile(path.join(process.cwd(), source.file), 'utf8');
      all.push(...parse(text, source.platform).filter((entry) => !entry.version.includes('-')));
    } catch {
      // Thiếu file thì bỏ qua bản đó.
    }
  }
  // Cùng ngày: giữ thứ tự trong file (Windows trước, rồi macOS từ mới tới cũ). `sort` của JS ổn định.
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

/** `2026-10-03` → `03/10/2026`. */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}
