/**
 * A window's tabs (like GitKraken): each tab holds its own screen (the welcome screen, the trust prompt, or one open repo).
 * Only the selected tab is drawn; a repo in a background tab stays alive (watcher, autofetch), so switching tabs shows it
 * immediately. This store only manages the list plus the selected tab — opening / closing repos is App.svelte's job.
 */
export interface Tab<V> {
  readonly id: number;
  readonly view: V;
}

/** One tab on the tab bar (its label is pre-rendered for display). */
export interface TabItem {
  readonly id: number;
  readonly title: string;
  /** The tooltip line on hover (a repo path…). */
  readonly tooltip: string;
}

export class TabsStore<V> {
  tabs = $state.raw<readonly Tab<V>[]>([]);
  activeId = $state<number | null>(null);
  private nextId = 1;

  get active(): Tab<V> | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId);
  }

  get activeIndex(): number {
    return this.tabs.findIndex((tab) => tab.id === this.activeId);
  }

  get(id: number): Tab<V> | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  /** Add a tab right after the selected one (or at the end); selected by default. Returns its id. */
  add(view: V, options: { activate?: boolean } = {}): number {
    const tab: Tab<V> = { id: this.nextId++, view };
    const index = this.activeIndex;
    const next = [...this.tabs];
    next.splice(index < 0 ? next.length : index + 1, 0, tab);
    this.tabs = next;
    if (options.activate ?? true) this.activeId = tab.id;
    return tab.id;
  }

  /** Change a tab's screen (ignored when the tab is gone). */
  set(id: number, view: V): void {
    if (!this.get(id)) return;
    this.tabs = this.tabs.map((tab) => (tab.id === id ? { id, view } : tab));
  }

  /** Remove a tab from the list; when it was selected, select the one to its right (or the left one at the end). Returns the removed tab. */
  remove(id: number): Tab<V> | undefined {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return undefined;
    const removed = this.tabs[index];
    this.tabs = this.tabs.filter((tab) => tab.id !== id);
    if (this.activeId === id) {
      this.activeId = (this.tabs[index] ?? this.tabs[index - 1])?.id ?? null;
    }
    return removed;
  }

  activate(id: number): void {
    if (this.get(id)) this.activeId = id;
  }

  /** Select a tab by position (Ctrl + 1…8); `-1` = the last tab (Ctrl + 9, like a browser). */
  activateIndex(index: number): void {
    const tab = index === -1 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activeId = tab.id;
  }

  /** Next / previous tab, wrapping around (Ctrl + Tab / Ctrl + Shift + Tab). */
  cycle(delta: 1 | -1): void {
    const count = this.tabs.length;
    if (count < 2) return;
    const index = Math.max(0, this.activeIndex);
    this.activeId = this.tabs[(index + delta + count) % count]?.id ?? this.activeId;
  }

  /** Drag tab `id` to position `index`. */
  move(id: number, index: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from < 0) return;
    const next = [...this.tabs];
    const [tab] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, tab!);
    this.tabs = next;
  }

  find(predicate: (view: V) => boolean): Tab<V> | undefined {
    return this.tabs.find((tab) => predicate(tab.view));
  }
}
