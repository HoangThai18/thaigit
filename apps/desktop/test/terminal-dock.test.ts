import { describe, expect, it } from 'vitest';
import { TERMINAL_HEIGHT, TerminalDock } from '../src/lib/terminal/dock.svelte.ts';

describe('TerminalDock', () => {
  it('lần đầu mở thì tạo một tab, ẩn thì giữ nguyên tab', () => {
    const dock = new TerminalDock();
    dock.toggle();
    expect(dock.visible).toBe(true);
    expect(dock.tabs.map((tab) => tab.title)).toEqual(['Terminal']);
    dock.toggle();
    expect(dock.visible).toBe(false);
    dock.toggle();
    expect(dock.tabs).toHaveLength(1);
  });

  it('thêm / đóng tab, đóng tab cuối thì ẩn panel', () => {
    const dock = new TerminalDock();
    dock.toggle();
    dock.add();
    expect(dock.tabs.map((tab) => tab.title)).toEqual(['Terminal', 'Terminal 2']);
    expect(dock.selected).toBe(2);
    dock.close(2);
    expect(dock.selected).toBe(1);
    dock.close(1);
    expect(dock.tabs).toHaveLength(0);
    expect(dock.selected).toBeNull();
    expect(dock.visible).toBe(false);
  });

  it('đổi tên theo tiêu đề shell (bỏ trống thì giữ), giới hạn chiều cao', () => {
    const dock = new TerminalDock();
    dock.add();
    dock.rename(1, '  ~/repo  ');
    dock.rename(1, '   ');
    expect(dock.tabs[0]?.title).toBe('~/repo');
    dock.resize(10);
    expect(dock.height).toBe(TERMINAL_HEIGHT.min);
    dock.resize(5000);
    expect(dock.height).toBe(TERMINAL_HEIGHT.max);
  });
});
