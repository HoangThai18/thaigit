import type { FileChange, WorkingTreeStatus } from '@thaigit/core';
import { describe, expect, it } from 'vitest';
import { workingTreeSummary } from '../src/lib/graph/wip.ts';
import { avatarColorIndex, changeTone, summarizeChanges } from '../src/lib/inspector/changes.ts';

const change = (path: string, kind: FileChange['kind']): FileChange => ({ path, kind });

function status(parts: Partial<Pick<WorkingTreeStatus, 'staged' | 'unstaged' | 'conflicts'>>) {
  return { staged: [], unstaged: [], conflicts: [], ...parts };
}

describe('workingTreeSummary', () => {
  it('sạch → rỗng', () => {
    expect(workingTreeSummary(status({}))).toBe('');
  });

  it('đếm file sửa theo đường dẫn khác nhau (staged + unstaged), file mới, đã stage, xung đột', () => {
    const summary = workingTreeSummary(
      status({
        staged: [change('a.ts', 'modified'), change('b.ts', 'added')],
        unstaged: [change('a.ts', 'modified'), change('c.ts', 'modified'), change('new.txt', 'untracked')],
        conflicts: [{ path: 'x', kind: 'bothModified' }],
      }),
    );
    expect(summary).toBe('⚠︎ 1 xung đột   ✎ 3 file sửa   ＋ 1 file mới   ● 2 đã stage');
  });

  it('chỉ file mới chưa track', () => {
    expect(
      workingTreeSummary(status({ unstaged: [change('n', 'untracked'), change('m', 'untracked')] })),
    ).toBe('＋ 2 file mới');
  });
});

describe('summarizeChanges / changeTone', () => {
  it('gom thêm/sửa/xoá (đổi tên và đổi loại tính là sửa)', () => {
    const files = [
      change('a', 'added'),
      change('b', 'untracked'),
      change('c', 'modified'),
      change('d', 'renamed'),
      change('e', 'typeChanged'),
      change('f', 'deleted'),
      change('g', 'conflicted'),
    ];
    expect(summarizeChanges(files)).toEqual({ added: 2, modified: 3, deleted: 1 });
  });

  it('tông màu theo loại', () => {
    expect(changeTone('added')).toBe('add');
    expect(changeTone('modified')).toBe('modify');
    expect(changeTone('deleted')).toBe('delete');
    expect(changeTone('renamed')).toBe('rename');
    expect(changeTone('conflicted')).toBe('warning');
    expect(changeTone('unknown')).toBe('muted');
  });
});

describe('avatarColorIndex', () => {
  it('khớp công thức djb2 Int64 của AvatarView (giá trị tính độc lập bằng Python)', () => {
    expect(avatarColorIndex('Phan Thái')).toBe(6);
    expect(avatarColorIndex('Lê Minh Châu')).toBe(7);
    expect(avatarColorIndex('Nguyễn Văn An')).toBe(11);
    expect(avatarColorIndex('Trần Thị Bình')).toBe(3);
    expect(avatarColorIndex('Đỗ Quốc Huy')).toBe(8);
  });

  it('ổn định, nằm trong bảng màu, chịu được tên rất dài và rỗng', () => {
    const long = 'x'.repeat(5000);
    expect(avatarColorIndex(long)).toBe(avatarColorIndex(long));
    expect(avatarColorIndex(long)).toBeGreaterThanOrEqual(0);
    expect(avatarColorIndex(long)).toBeLessThan(12);
    expect(avatarColorIndex('')).toBe(5381 % 12);
  });
});
