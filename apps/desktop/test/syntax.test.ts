import { describe, expect, it } from 'vitest';
import { languageFor, lineSegments, tokenizeLine } from '../src/lib/diff/syntax.ts';

describe('tô màu cú pháp trong diff', () => {
  it('chọn ngôn ngữ theo đuôi / tên file', () => {
    expect(languageFor('src/app.ts')).toBe('typescript');
    expect(languageFor('a/B.TSX')).toBe('tsx');
    expect(languageFor('src-tauri/src/rebase.rs')).toBe('rust');
    expect(languageFor('App.svelte')).toBe('component');
    expect(languageFor('docker/Dockerfile')).toBe('docker');
    expect(languageFor('README')).toBeNull();
    expect(languageFor('ảnh.png')).toBeNull();
  });

  it('tách dòng thành token, giữ nguyên chữ (không HTML), ngôn ngữ lạ thì một đoạn thường', () => {
    const line = 'const name = "<b>Thái</b>"; // ghi chú';
    const tokens = tokenizeLine(line, 'typescript');
    expect(tokens.map((token) => token.text).join('')).toBe(line);
    expect(tokens.find((token) => token.text === 'const')?.type).toBe('keyword');
    expect(tokens.find((token) => token.text.includes('<b>'))?.type).toBe('string');
    expect(tokens.find((token) => token.text.includes('ghi chú'))?.type).toBe('comment');
    expect(tokenizeLine('x', null)).toEqual([{ text: 'x', type: null }]);
    // Svelte / Vue: dòng thẻ tô kiểu markup, dòng script kiểu TypeScript.
    expect(tokenizeLine('  import { x } from "y";', 'component').find((t) => t.text === 'import')?.type).toBe(
      'keyword',
    );
    expect(tokenizeLine('<div class="a">', 'component').some((t) => t.type === 'tag')).toBe(true);
    expect(tokenizeLine('x', 'không-có')).toEqual([{ text: 'x', type: null }]);
  });

  it('cắt token ở ranh giới vùng đổi trong dòng', () => {
    const tokens = [
      { text: 'let ', type: 'keyword' },
      { text: 'abcdef', type: null },
    ];
    expect(lineSegments(tokens, { start: 2, end: 6 })).toEqual([
      { text: 'le', type: 'keyword', marked: false },
      { text: 't ', type: 'keyword', marked: true },
      { text: 'ab', type: null, marked: true },
      { text: 'cdef', type: null, marked: false },
    ]);
    expect(lineSegments(tokens, null).every((segment) => !segment.marked)).toBe(true);
  });
});
