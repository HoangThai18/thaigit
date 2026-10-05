/**
 * Trạng thái panel terminal của một cửa sổ repo (như app Swift `TerminalSession`): danh sách tab, tab đang chọn, ẩn / hiện,
 * chiều cao. Phiên shell và xterm nằm trong `TerminalPanel` (gắn với từng tab) — bỏ tab khỏi danh sách là dừng shell của tab.
 */
import { vi } from '../strings.vi.ts';

export interface TerminalTab {
  readonly key: number;
  readonly title: string;
}

export const TERMINAL_HEIGHT = { min: 120, max: 900, initial: 280 } as const;

export class TerminalDock {
  visible = $state(false);
  /** `$state.raw`: tab là bản ghi bất biến, đổi tiêu đề thì thay cả mảng. */
  tabs = $state.raw<readonly TerminalTab[]>([]);
  selected = $state<number | null>(null);
  height = $state<number>(TERMINAL_HEIGHT.initial);
  private created = 0;

  /** Bật / tắt panel (Ctrl+`); lần đầu mở thì tạo một tab. */
  toggle(): void {
    if (!this.visible && this.tabs.length === 0) this.add();
    this.visible = !this.visible;
  }

  add(): void {
    this.created += 1;
    const tab = {
      key: this.created,
      title: this.created === 1 ? vi.terminal.title : vi.terminal.titleNumbered(this.created),
    };
    this.tabs = [...this.tabs, tab];
    this.selected = tab.key;
  }

  close(key: number): void {
    this.tabs = this.tabs.filter((tab) => tab.key !== key);
    if (this.selected === key) this.selected = this.tabs.at(-1)?.key ?? null;
    if (this.tabs.length === 0) this.visible = false;
  }

  /** Tiêu đề shell tự đặt (escape OSC) — chỉ hiện dạng text, cắt ngắn. */
  rename(key: number, title: string): void {
    const trimmed = title.trim().slice(0, 40);
    if (trimmed === '') return;
    this.tabs = this.tabs.map((tab) => (tab.key === key ? { key, title: trimmed } : tab));
  }

  resize(height: number): void {
    this.height = Math.min(Math.max(Math.round(height), TERMINAL_HEIGHT.min), TERMINAL_HEIGHT.max);
  }
}
