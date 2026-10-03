// Rào chắn bảo mật (phase 4, "Security Considerations"): chuỗi từ repo (message, tác giả, tên nhánh/file) chỉ được render dạng text.
// ESLint chỉ chặn `{@html …}` (svelte/no-at-html-tags) nên rào chắn chính vẫn là test này: cấm cả `{@html …}` lẫn các API chèn
// HTML thô trong mã giao diện.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(name) ? [path] : [];
  });
}

/** Bỏ chú thích để câu chữ "không dùng {@html}" trong chú thích không bị tính. */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('không chèn HTML thô', () => {
  const files = sourceFiles(SRC);

  it('có file để quét', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((file) => [relative(SRC, file), file] as const))('%s', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/\{@html\b/);
    expect(code).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
    expect(code).not.toMatch(/\b(eval|new Function)\s*\(/);
  });
});
