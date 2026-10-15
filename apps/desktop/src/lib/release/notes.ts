// The "What's New" tab (like GitKraken's Release Notes and the Swift 1.x app): reads the CHANGELOG.md bundled into the
// app at build time and splits it into one card per version. Rendered as plain text segments only — the changelog is
// our own file, but the UI never injects HTML.

import changelog from '../../../CHANGELOG.md?raw';

export interface NotesSection {
  /** "2.6.5", or the "Chưa phát hành" heading as written. */
  readonly title: string;
  readonly date: string | null;
  readonly isUnreleased: boolean;
  readonly paragraphs: readonly string[];
  readonly items: readonly string[];
}

/** A run of inline text: `**bold**` and `` `code` `` are marked, links keep only their label. */
export interface InlineSegment {
  readonly text: string;
  readonly style: 'plain' | 'bold' | 'code';
}

const UNRELEASED = /^chưa phát hành$/i;

export function parseNotes(markdown: string): NotesSection[] {
  const sections: { title: string; date: string | null; paragraphs: string[]; items: string[] }[] = [];
  let current: (typeof sections)[number] | null = null;
  let inItem = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      const [title = heading, date = null] = heading.split(/\s+[—–-]\s+/, 2);
      current = { title: title.trim(), date: date?.trim() ?? null, paragraphs: [], items: [] };
      sections.push(current);
      inItem = false;
      continue;
    }
    if (current === null) continue;
    if (line.trim() === '') {
      inItem = false;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      current.items.push(bullet[1] ?? '');
      inItem = true;
    } else if (inItem && /^\s+/.test(line)) {
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    } else {
      current.paragraphs.push(line.replace(/^#+\s*/, '').trim());
      inItem = false;
    }
  }
  return sections.map((section) => ({ ...section, isUnreleased: UNRELEASED.test(section.title) }));
}

export function inlineSegments(text: string): InlineSegment[] {
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const segments: InlineSegment[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let match = pattern.exec(plain); match; match = pattern.exec(plain)) {
    if (match.index > last) segments.push({ text: plain.slice(last, match.index), style: 'plain' });
    if (match[1] !== undefined) segments.push({ text: match[1], style: 'bold' });
    else segments.push({ text: match[2] ?? '', style: 'code' });
    last = match.index + match[0].length;
  }
  if (last < plain.length) segments.push({ text: plain.slice(last), style: 'plain' });
  return segments;
}

export const bundledNotes: readonly NotesSection[] = parseNotes(changelog);
