// Markdown của AI (giải thích commit, mô tả PR) → khối dữ liệu để Svelte vẽ dạng chữ. Chỉ cho phép một tập nhỏ: tiêu đề,
// gạch đầu dòng, đoạn, khối code, **đậm**, *nghiêng*, `code`. Không HTML, không ảnh; link chỉ còn chữ (kèm địa chỉ dạng
// chữ) — model có thể bị diff lạ dụ chèn link / HTML, nên không gì trong đây được thành phần tử bấm được hay markup.

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'item'; ordered: boolean; marker: string; depth: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'code'; text: string };

/** Link / ảnh → chữ thuần. */
function flattenLinks(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) =>
      label === url ? label : `${label} (${url})`,
    )
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

export function parseInline(source: string): Inline[] {
  const text = flattenLinks(source);
  const out: Inline[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) out.push({ kind: 'code', text: token.slice(1, -1) });
    else if (match[2]) out.push({ kind: 'bold', text: token.slice(2, -2) });
    else out.push({ kind: 'italic', text: token.slice(1, -1) });
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (
        index += 1;
        index < lines.length && !(lines[index] ?? '').trim().startsWith(fence[1] ?? '```');
        index += 1
      ) {
        code.push(lines[index] ?? '');
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, inlines: parseInline(heading[2] ?? '') });
      continue;
    }
    const item = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const marker = item[2] ?? '-';
      const ordered = /\d/.test(marker);
      blocks.push({
        kind: 'item',
        ordered,
        marker: ordered ? marker : '•',
        depth: Math.min(3, Math.floor((item[1]?.length ?? 0) / 2)),
        inlines: parseInline(item[3] ?? ''),
      });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
