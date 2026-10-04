import { describe, expect, it } from 'vitest';
import {
  fileToPalette,
  filterPalette,
  menuToPalette,
  refToPalette,
  type PaletteItem,
} from '../src/lib/shell/commandPalette.ts';
import { local, remote, tag } from './helpers/models.ts';

const noop = () => {};

describe('command palette', () => {
  const actions = menuToPalette([
    { title: 'Fetch', icon: 'fetch', shortcut: 'Ctrl + Alt + F', run: noop },
    { kind: 'separator' },
    { title: 'Push', icon: 'push', run: noop },
    { title: 'Tắt', run: noop, disabled: true },
    { kind: 'submenu', title: 'Reset main về đây', items: [{ title: 'Hard — bỏ mọi thay đổi', run: noop }] },
    { title: 'Đồng bộ (pull rồi push)', icon: 'push', run: noop },
    { title: 'Stash tất cả thay đổi', icon: 'stash', run: noop },
  ]);
  const items: PaletteItem[] = [
    ...actions,
    refToPalette(local('feature/đăng-nhập', 'a'), 'Checkout feature/đăng-nhập', noop),
    refToPalette(remote('origin/push-fix', 'b'), 'Checkout origin/push-fix', noop),
    refToPalette(tag('v1.0', 'c'), 'Checkout tag v1.0', noop),
    fileToPalette({ path: 'src/stash/view.ts', kind: 'modified' }, 'Xem diff: view.ts', noop),
  ];

  it('menu → mục palette: bỏ vách ngăn và mục tắt, trải phẳng menu con', () => {
    expect(actions.map((item) => item.title)).toEqual([
      'Fetch',
      'Push',
      'Reset main về đây › Hard — bỏ mọi thay đổi',
      'Đồng bộ (pull rồi push)',
      'Stash tất cả thay đổi',
    ]);
    expect(actions[0]?.shortcut).toBe('Ctrl + Alt + F');
  });

  it('chưa gõ gì: chỉ thao tác; gõ: không phân biệt dấu, mọi từ phải khớp, khớp đầu tiêu đề lên trước', () => {
    expect(filterPalette('', items).every((item) => item.group === 'action')).toBe(true);
    expect(filterPalette('dang nhap', items).map((item) => item.title)).toEqual([
      'Checkout feature/đăng-nhập',
    ]);
    expect(filterPalette('push', items).map((item) => item.title)).toEqual([
      'Push',
      'Đồng bộ (pull rồi push)',
      'Checkout origin/push-fix',
    ]);
    expect(filterPalette('stash', items).map((item) => item.group)).toEqual(['action', 'file']);
    expect(filterPalette('v1', items)[0]?.group).toBe('tag');
    expect(filterPalette('không có gì', items)).toEqual([]);
  });
});
