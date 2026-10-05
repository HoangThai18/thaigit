// Ẩn / solo nhánh trên graph: đối số git log và lịch sử thật.

import { describe, expect, it } from 'vitest';
import { escapeGlob, keepingRefs, refFilterRevisionArgs, refVisible } from '../src/graph/index.ts';
import { withTestRepo } from './helpers/test-repo.ts';

describe('bộ lọc nhánh trên graph', () => {
  it('đối số git log cho ẩn và solo', () => {
    const options = { includeHead: true, includeRemotes: true, includeTags: false };
    expect(refFilterRevisionArgs({ hidden: [], solo: [] }, options)).toEqual([
      '--branches',
      '--remotes',
      'HEAD',
    ]);
    expect(
      refFilterRevisionArgs({ hidden: ['refs/heads/a*b', 'refs/remotes/origin/x'], solo: [] }, options),
    ).toEqual(['--exclude=a\\*b', '--branches', '--exclude=origin/x', '--remotes', 'HEAD']);
    expect(
      refFilterRevisionArgs({ hidden: ['refs/heads/a'], solo: ['refs/heads/z', 'refs/heads/b'] }, options),
    ).toEqual(['refs/heads/b', 'refs/heads/z', 'HEAD']);
    expect(escapeGlob('f[1]?\\')).toBe('f\\[1\\]\\?\\\\');
  });

  it('nhánh hiện / ẩn và bỏ ref đã xoá', () => {
    expect(refVisible({ hidden: ['refs/heads/a'], solo: [] }, 'refs/heads/a')).toBe(false);
    expect(refVisible({ hidden: [], solo: ['refs/heads/b'] }, 'refs/heads/a')).toBe(false);
    expect(refVisible({ hidden: [], solo: ['refs/heads/b'] }, 'refs/heads/b')).toBe(true);
    expect(
      keepingRefs({ hidden: ['refs/heads/x', 'refs/heads/y'], solo: [] }, new Set(['refs/heads/y'])),
    ).toEqual({
      hidden: ['refs/heads/y'],
      solo: [],
    });
  });

  it('git log thật: ẩn nhánh bỏ commit riêng của nó, solo chỉ còn nhánh đó và HEAD', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'a\n');
      await t.commitAll('gốc');
      t.git('switch', '-q', '-c', 'an');
      await t.write('b.txt', 'b\n');
      await t.commitAll('riêng nhánh ẩn');
      t.git('switch', '-q', 'main');
      t.git('switch', '-q', '-c', 'khac');
      await t.write('c.txt', 'c\n');
      await t.commitAll('riêng nhánh khác');
      t.git('switch', '-q', 'main');
      const subjects = async (hidden: string[], solo: string[]): Promise<string[]> =>
        (await t.repo.log({ limit: 50, order: 'date', includeHead: true, filter: { hidden, solo } })).map(
          (commit) => commit.subject,
        );
      expect((await subjects([], [])).sort()).toEqual(['gốc', 'riêng nhánh khác', 'riêng nhánh ẩn']);
      expect((await subjects(['refs/heads/an'], [])).sort()).toEqual(['gốc', 'riêng nhánh khác']);
      expect((await subjects([], ['refs/heads/an'])).sort()).toEqual(['gốc', 'riêng nhánh ẩn']);
    }));
});
