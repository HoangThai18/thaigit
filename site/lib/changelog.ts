import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  items: string[];
}

/** Đọc CHANGELOG.md ở gốc repo lúc build: "## 1.0.0 — 2026-10-02", đoạn mô tả, rồi các dòng "- …". */
export async function readChangelog(limit = 3): Promise<ChangelogEntry[]> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), '..', 'CHANGELOG.md'), 'utf8');
  } catch {
    return [];
  }
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+([^\s—-]+)\s*[—-]?\s*(.*)$/.exec(line);
    if (heading) {
      current = { version: heading[1] ?? '', date: heading[2] ?? '', summary: '', items: [] };
      entries.push(current);
      continue;
    }
    if (!current || !line) continue;
    if (line.startsWith('- ')) current.items.push(line.slice(2).replace(/`/g, ''));
    else if (!current.summary) current.summary = line;
  }
  return entries.slice(0, limit);
}
