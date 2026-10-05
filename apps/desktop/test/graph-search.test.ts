// Commit search on the graph: diacritic- and case-insensitive; matches subject, author, email, SHA prefix, branch label.
import { describe, expect, it } from 'vitest';
import { findMatches } from '../src/lib/graph/search.svelte.ts';
import type { GraphEntry } from '../src/lib/stores/repo.svelte.ts';
import { commit } from './helpers/models.ts';

function entry(id: string, subject: string, author = 'Thái', labels: string[] = []): GraphEntry {
  return {
    commit: commit(id, [], { subject, authorName: author, authorEmail: `${author}@example.com` }),
    row: {} as GraphEntry['row'],
    labels: labels.map((text) => ({
      key: text,
      text,
      isCurrentBranch: false,
      hasLocal: true,
      remoteCount: 0,
      isTag: false,
      isDetachedHead: false,
      refs: [],
    })),
  };
}

const entries = [
  entry('a1b2c3d4e5', 'Sửa lỗi đăng nhập'),
  entry('f00ba4', 'Thêm README', 'Lan'),
  entry('0123abcd', 'Dọn code', 'Minh', ['tinh-nang/dang-nhap']),
];

describe('findMatches', () => {
  it('bỏ dấu, không phân biệt hoa thường', () => {
    expect(findMatches(entries, 'dang nhap')).toEqual([0]);
    expect(findMatches(entries, 'ĐĂNG')).toEqual([0, 2]);
    expect(findMatches(entries, 'readme')).toEqual([1]);
  });

  it('tác giả, email, tiền tố SHA (≥ 4 ký tự hex)', () => {
    expect(findMatches(entries, 'lan')).toEqual([1]);
    expect(findMatches(entries, 'minh@example')).toEqual([2]);
    expect(findMatches(entries, 'A1B2')).toEqual([0]);
    expect(findMatches(entries, '   ')).toEqual([]);
  });
});
