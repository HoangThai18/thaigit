/**
 * Lịch sử một file (panel bên phải, thay chi tiết khi mở — như "File History" của GitKraken): các commit đụng tới file, theo dấu
 * qua các lần đổi tên. Chọn một commit để xem thay đổi của riêng file đó ở vùng giữa.
 */
import type { FileHistoryEntry, GitRepository } from '@thaigit/core';
import type { DiffStore } from '../stores/diff.svelte.ts';
import { vi } from '../strings.vi.ts';

/** Số commit tối đa đọc một lần (file sửa rất nhiều lần vẫn mở nhanh). */
export const FILE_HISTORY_LIMIT = 500;

/** Phần của `RepoStore` mà lịch sử file cần (tránh import vòng). */
export interface FileHistoryHost {
  readonly git: GitRepository;
  readonly diff: DiffStore;
  /** Hai panel cùng chỗ bên phải: mở lịch sử file thì đóng Dòng thời gian. */
  closeTimeline(): void;
  showError(title: string, error: unknown): void;
}

export class FileHistoryStore {
  /** Đường dẫn file đang xem lịch sử (tên hiện tại); `null` = panel đóng. */
  path = $state<string | null>(null);
  entries = $state.raw<readonly FileHistoryEntry[]>([]);
  loading = $state(false);
  failed = $state(false);
  selected = $state.raw<FileHistoryEntry | null>(null);
  private token = 0;

  constructor(private readonly host: FileHistoryHost) {}

  get isOpen(): boolean {
    return this.path !== null;
  }

  /** Đã chạm giới hạn đọc: có thể còn commit cũ hơn. */
  get limited(): boolean {
    return this.entries.length >= FILE_HISTORY_LIMIT;
  }

  open(path: string): void {
    this.host.closeTimeline();
    this.path = path;
    this.entries = [];
    this.selected = null;
    void this.load();
  }

  close(): void {
    if (this.path === null) return;
    this.token++;
    this.path = null;
    this.entries = [];
    this.selected = null;
    this.loading = false;
    this.failed = false;
    if (this.host.diff.file?.source.kind === 'commit') this.host.diff.close();
  }

  async load(): Promise<void> {
    const path = this.path;
    if (path === null) return;
    const token = ++this.token;
    this.loading = true;
    this.failed = false;
    try {
      const entries = await this.host.git.fileHistory(path, FILE_HISTORY_LIMIT);
      if (token === this.token) this.entries = entries;
    } catch (error) {
      if (token !== this.token) return;
      this.failed = true;
      this.host.showError(vi.history.loadFailed, error);
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  /** Chọn một commit: mở thay đổi của file đó (so với cha đầu tiên) ở vùng giữa. */
  select(entry: FileHistoryEntry): void {
    this.selected = entry;
    const commit = entry.commit;
    this.host.diff.open(entry.change, { kind: 'commit', sha: commit.id, parent: commit.parents[0] ?? null });
  }
}
