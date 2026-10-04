import { describe, expect, it } from 'vitest';
import { sanitizePrefs } from '../src/lib/stores/prefs.svelte.ts';
import { TabsStore } from '../src/lib/stores/tabs.svelte.ts';

const names = (store: TabsStore<string>): string[] => store.tabs.map((tab) => tab.view);

describe('TabsStore', () => {
  it('thêm sau tab đang chọn, đóng thì chọn tab bên phải (hết thì bên trái)', () => {
    const tabs = new TabsStore<string>();
    const a = tabs.add('a');
    const b = tabs.add('b');
    tabs.activate(a);
    const c = tabs.add('c');
    expect(names(tabs)).toEqual(['a', 'c', 'b']);
    expect(tabs.activeId).toBe(c);

    tabs.remove(c);
    expect(tabs.active?.view).toBe('b');
    tabs.remove(b);
    expect(tabs.active?.view).toBe('a');
    expect(tabs.remove(999)).toBeUndefined();
    tabs.remove(a);
    expect(tabs.activeId).toBeNull();
    expect(tabs.active).toBeUndefined();
  });

  it('thêm không chọn, đổi màn hình, tìm, chuyển vòng, chọn theo số, kéo đổi chỗ', () => {
    const tabs = new TabsStore<string>();
    const a = tabs.add('a');
    const b = tabs.add('b', { activate: false });
    tabs.add('c', { activate: false });
    expect(tabs.activeId).toBe(a);
    expect(names(tabs)).toEqual(['a', 'c', 'b']);

    tabs.set(b, 'B');
    tabs.set(12345, 'không có');
    expect(tabs.find((view) => view === 'B')?.id).toBe(b);

    tabs.cycle(-1);
    expect(tabs.active?.view).toBe('B');
    tabs.cycle(1);
    expect(tabs.active?.view).toBe('a');
    tabs.activateIndex(1);
    expect(tabs.active?.view).toBe('c');
    tabs.activateIndex(-1);
    expect(tabs.active?.view).toBe('B');
    tabs.activateIndex(7);
    expect(tabs.active?.view).toBe('B');

    tabs.move(b, 0);
    expect(names(tabs)).toEqual(['B', 'a', 'c']);
    tabs.move(b, 99);
    expect(names(tabs)).toEqual(['a', 'c', 'B']);
  });

  it('một tab thì Ctrl + Tab không làm gì', () => {
    const tabs = new TabsStore<string>();
    const only = tabs.add('x');
    tabs.cycle(1);
    expect(tabs.activeId).toBe(only);
  });
});

describe('cài đặt nhớ tab', () => {
  it('mặc định rỗng; giá trị hỏng bị lọc / kẹp', () => {
    expect(sanitizePrefs(null)).toMatchObject({ openTabs: [], activeTab: 0 });
    const odd = sanitizePrefs({ openTabs: ['a', 3, '', 'a', 'b'], activeTab: 500 });
    expect(odd.openTabs).toEqual(['a', 'b']);
    expect(odd.activeTab).toBe(19);
  });
});
