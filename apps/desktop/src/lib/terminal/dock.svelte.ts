/**
 * Terminal panel state for one repo window (like the Swift app's `TerminalSession`): the tab list, the
 * selected tab, hidden / shown, and the height. The shell session and xterm live in `TerminalPanel` (attached
 * per tab) — removing a tab from the list stops that tab's shell.
 */
import { vi } from '../strings.vi.ts';

export interface TerminalTab {
  readonly key: number;
  readonly title: string;
}

export const TERMINAL_HEIGHT = { min: 120, max: 900, initial: 280 } as const;

export class TerminalDock {
  visible = $state(false);
  /** `$state.raw`: a tab is an immutable record, so changing its title replaces the whole array. */
  tabs = $state.raw<readonly TerminalTab[]>([]);
  selected = $state<number | null>(null);
  height = $state<number>(TERMINAL_HEIGHT.initial);
  private created = 0;

  /** Show / hide the panel (Ctrl+`); the first time it opens, create one tab. */
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

  /** Shell-chosen title (OSC escape) — shown as text only, truncated. */
  rename(key: number, title: string): void {
    const trimmed = title.trim().slice(0, 40);
    if (trimmed === '') return;
    this.tabs = this.tabs.map((tab) => (tab.key === key ? { key, title: trimmed } : tab));
  }

  resize(height: number): void {
    this.height = Math.min(Math.max(Math.round(height), TERMINAL_HEIGHT.min), TERMINAL_HEIGHT.max);
  }
}
