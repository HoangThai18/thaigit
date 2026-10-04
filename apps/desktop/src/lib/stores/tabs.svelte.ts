/**
 * Tab của một cửa sổ (như GitKraken): mỗi tab giữ một màn hình riêng (màn hình chào, hỏi tin tưởng, hoặc một repo đang mở).
 * Chỉ tab đang chọn được vẽ; repo ở tab nền vẫn sống (watcher, tự fetch) nên chuyển tab là thấy ngay. Store này chỉ lo danh
 * sách + tab đang chọn — mở / đóng repo do App.svelte làm.
 */
export interface Tab<V> {
  readonly id: number;
  readonly view: V;
}

/** Một tab trên thanh tab (đã dựng sẵn chữ để hiển thị). */
export interface TabItem {
  readonly id: number;
  readonly title: string;
  /** Dòng chú thích khi rê chuột (đường dẫn repo…). */
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

  /** Thêm tab ngay sau tab đang chọn (hoặc cuối danh sách); mặc định chọn luôn. Trả id. */
  add(view: V, options: { activate?: boolean } = {}): number {
    const tab: Tab<V> = { id: this.nextId++, view };
    const index = this.activeIndex;
    const next = [...this.tabs];
    next.splice(index < 0 ? next.length : index + 1, 0, tab);
    this.tabs = next;
    if (options.activate ?? true) this.activeId = tab.id;
    return tab.id;
  }

  /** Đổi màn hình của một tab (tab đã đóng thì bỏ qua). */
  set(id: number, view: V): void {
    if (!this.get(id)) return;
    this.tabs = this.tabs.map((tab) => (tab.id === id ? { id, view } : tab));
  }

  /** Bỏ tab khỏi danh sách; đang chọn thì chọn tab bên phải (hết thì bên trái). Trả tab đã bỏ. */
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

  /** Chọn tab theo vị trí (Ctrl + 1…8); `-1` = tab cuối (Ctrl + 9, như trình duyệt). */
  activateIndex(index: number): void {
    const tab = index === -1 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activeId = tab.id;
  }

  /** Tab kế / trước, vòng quanh (Ctrl + Tab / Ctrl + Shift + Tab). */
  cycle(delta: 1 | -1): void {
    const count = this.tabs.length;
    if (count < 2) return;
    const index = Math.max(0, this.activeIndex);
    this.activeId = this.tabs[(index + delta + count) % count]?.id ?? this.activeId;
  }

  /** Kéo tab `id` tới vị trí `index`. */
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
