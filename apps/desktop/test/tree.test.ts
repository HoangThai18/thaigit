import { refName } from '@thaigit/core';
import { describe, expect, it } from 'vitest';
import { compareNatural, containsFolded, foldText } from '../src/lib/format/natural.ts';
import {
  FOLDER_COLLAPSE_THRESHOLD,
  PAGE_STEP,
  buildBranchTree,
  folderStartsExpanded,
  nextPage,
  type BranchNode,
} from '../src/lib/sidebar/tree.ts';
import { local } from './helpers/models.ts';

function shape(nodes: readonly BranchNode[]): unknown[] {
  return nodes.map((node) => (node.ref ? node.name : { [node.name]: shape(node.children) }));
}

describe('buildBranchTree', () => {
  it('nhóm theo "/": thư mục trước, nhánh lá sau', () => {
    const refs = ['main', 'feature/b', 'bugfix/tinh-tien', 'feature/a', 'dev'].map((name) =>
      local(name, 'x'),
    );
    const tree = buildBranchTree(refs, refName);
    expect(shape(tree)).toEqual([{ feature: ['b', 'a'] }, { bugfix: ['tinh-tien'] }, 'main', 'dev']);
  });

  it('thư mục lồng nhau và đếm lá gồm cả thư mục con', () => {
    const refs = ['a/b/c', 'a/b/d', 'a/e', 'f'].map((name) => local(name, 'x'));
    const tree = buildBranchTree(refs, refName);
    expect(shape(tree)).toEqual([{ a: [{ b: ['c', 'd'] }, 'e'] }, 'f']);
    expect(tree[0]?.leafCount).toBe(3);
    expect(tree[0]?.children[0]?.leafCount).toBe(2);
    expect(tree[1]?.leafCount).toBe(1);
  });

  it('id: thư mục theo đường dẫn, lá theo tên đầy đủ của ref (không đụng nhau giữa các cấp)', () => {
    const refs = ['x/y', 'y'].map((name) => local(name, 'x'));
    const tree = buildBranchTree(refs, refName);
    expect(tree.map((node) => node.id)).toEqual(['folder:x', 'refs/heads/y']);
    expect(tree[0]?.children[0]?.id).toBe('refs/heads/x/y');
  });

  it('bỏ đoạn rỗng (dấu "/" thừa) và dùng hàm lấy tên tuỳ ý', () => {
    const refs = [local('a//b', 'x')];
    expect(shape(buildBranchTree(refs, refName))).toEqual([{ a: ['b'] }]);
    expect(shape(buildBranchTree(refs, () => 'solo'))).toEqual(['solo']);
  });

  it('repo nhiều nhánh: một thư mục 877 lá thu gọn, thư mục nhỏ mở sẵn', () => {
    const refs = [
      ...Array.from({ length: 877 }, (_, index) => local(`feature/f${index}`, 'x')),
      local('main', 'x'),
    ];
    const tree = buildBranchTree(refs, refName);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.leafCount).toBe(877);
    expect(folderStartsExpanded(tree[0]?.leafCount ?? 0)).toBe(false);
    expect(folderStartsExpanded(FOLDER_COLLAPSE_THRESHOLD)).toBe(true);
    expect(folderStartsExpanded(FOLDER_COLLAPSE_THRESHOLD + 1)).toBe(false);
  });
});

describe('nextPage', () => {
  it('thêm tối đa 200 mỗi lần, báo số còn lại', () => {
    expect(nextPage(877, 50)).toEqual({ step: PAGE_STEP, remaining: 827 });
    expect(nextPage(120, 50)).toEqual({ step: 70, remaining: 70 });
    expect(nextPage(50, 50)).toEqual({ step: 0, remaining: 0 });
  });
});

describe('compareNatural', () => {
  it('số theo giá trị, không phân biệt hoa/thường', () => {
    const sorted = ['f10', 'F2', 'f1', 'Dev', 'alpha'].sort(compareNatural);
    expect(sorted).toEqual(['alpha', 'Dev', 'f1', 'F2', 'f10']);
  });

  it('hai tên chỉ khác hoa/thường vẫn có thứ tự ổn định', () => {
    const a = compareNatural('Main', 'main');
    expect(a).not.toBe(0);
    expect(compareNatural('main', 'Main')).toBe(-a);
  });
});

describe('foldText / containsFolded', () => {
  it('bỏ dấu và hoa/thường, kể cả chữ đ', () => {
    expect(foldText('Tính-Tiền')).toBe('tinh-tien');
    expect(foldText('Đăng nhập')).toBe('dang nhap');
    expect(containsFolded('bugfix/tinh-tien', foldText('TÍNH'))).toBe(true);
    expect(containsFolded('main', foldText('dev'))).toBe(false);
    expect(containsFolded('main', '')).toBe(true);
  });
});
