// Changed files as a directory tree.
import type { FileChange } from '@thaigit/core';
import { describe, expect, it } from 'vitest';
import { fileTreeRows, type FileTreeRow } from '../src/lib/staging/fileTree.ts';

function describeRows(rows: readonly FileTreeRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'folder'
      ? `${'  '.repeat(row.depth)}${row.name}/ (${row.count})`
      : `${'  '.repeat(row.depth)}${row.change.path.split('/').at(-1)}`,
  );
}

const files: FileChange[] = [
  'src/app/views/a.js',
  'src/app/views/b.js',
  'src/lib/c.js',
  'README.md',
  'docs/guide/x.md',
].map((path) => ({ path, kind: 'modified' }));

describe('cây thư mục', () => {
  it('lồng thư mục, gộp chuỗi một con, thư mục trước file', () => {
    expect(describeRows(fileTreeRows(files))).toEqual([
      'docs/guide/ (1)',
      '  x.md',
      'src/ (3)',
      '  app/views/ (2)',
      '    a.js',
      '    b.js',
      '  lib/ (1)',
      '    c.js',
      'README.md',
    ]);
  });

  it('gập thư mục thì ẩn phần bên trong', () => {
    expect(describeRows(fileTreeRows(files, new Set(['src'])))).toEqual([
      'docs/guide/ (1)',
      '  x.md',
      'src/ (3)',
      'README.md',
    ]);
  });
});
