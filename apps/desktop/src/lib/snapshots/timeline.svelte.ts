/**
 * Panel Dòng thời gian (snapshot tự động của thư mục làm việc): danh sách mốc, so một mốc với "bây giờ" (chụp mốc hiện tại trước
 * nên thấy cả file chưa track), mở diff từng file ở vùng giữa, khôi phục một file / tất cả có hỏi trước và Hoàn tác trên toast.
 * Cũng giữ công tắc tự lưu theo repo.
 */
import { SnapshotStore, type FileChange, type GitRepository, type SnapshotEntry } from '@thaigit/core';
import { dialogs as globalDialogs, type DialogStore } from '../stores/dialogs.svelte.ts';
import type { DiffStore } from '../stores/diff.svelte.ts';
import type { PrefsStore } from '../stores/prefs.svelte.ts';
import type { ToastAction } from '../stores/toasts.svelte.ts';
import { vi } from '../strings.vi.ts';

/** Phần của `RepoStore` mà dòng thời gian cần (tránh import vòng). */
export interface TimelineHost {
  readonly git: GitRepository;
  readonly rootPath: string;
  readonly diff: DiffStore;
  readonly prefs: PrefsStore;
  perform(
    title: string,
    work: (git: GitRepository) => Promise<void>,
    options?: { refresh?: number; onSuccess?: () => void },
  ): Promise<void>;
  notify(
    style: 'info' | 'success' | 'warning',
    title: string,
    options?: { actions?: readonly ToastAction[] },
  ): void;
  showError(title: string, error: unknown): void;
  /** Hai panel cùng chỗ bên phải: mở Dòng thời gian thì đóng Lịch sử file. */
  closeFileHistory?(): void;
}

export interface TimelineComparison {
  readonly target: SnapshotEntry;
  readonly now: SnapshotEntry;
  readonly files: readonly FileChange[];
}

/** Phạm vi làm mới sau khi khôi phục: chỉ trạng thái working tree (`Scope.status`). */
const STATUS_SCOPE = 1;

export class TimelineStore {
  isOpen = $state(false);
  entries = $state.raw<readonly SnapshotEntry[]>([]);
  loading = $state(false);
  selected = $state.raw<SnapshotEntry | null>(null);
  comparison = $state.raw<TimelineComparison | null>(null);
  comparing = $state(false);
  private loadToken = 0;
  private compareToken = 0;
  private snapshotStore: SnapshotStore | null = null;

  constructor(private readonly host: TimelineHost) {}

  /** Tạo khi cần lần đầu: `host.git` là getter trỏ về `RepoStore` đang dựng nên chưa đọc được trong constructor. */
  get snapshots(): SnapshotStore {
    this.snapshotStore ??= new SnapshotStore(this.host.git);
    return this.snapshotStore;
  }

  /** Tự lưu đang bật cho repo này (cài đặt chung VÀ không bị tắt riêng). */
  get enabled(): boolean {
    const value = this.host.prefs.value;
    return value.snapshotsEnabled && !value.snapshotsDisabledRepos.includes(this.host.rootPath);
  }

  get disabledForRepo(): boolean {
    return this.host.prefs.value.snapshotsDisabledRepos.includes(this.host.rootPath);
  }

  setEnabledForRepo(enabled: boolean): void {
    const current = this.host.prefs.value.snapshotsDisabledRepos.filter(
      (root) => root !== this.host.rootPath,
    );
    this.host.prefs.update({ snapshotsDisabledRepos: enabled ? current : [...current, this.host.rootPath] });
  }

  open(): void {
    this.host.closeFileHistory?.();
    this.isOpen = true;
    void this.load();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.selected = null;
    this.comparison = null;
    this.compareToken++;
    if (this.host.diff.file?.source.kind === 'commit') this.host.diff.close();
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    try {
      const entries = await this.snapshots.list();
      if (token === this.loadToken) this.entries = entries;
    } catch (error) {
      if (token === this.loadToken) this.host.showError(vi.snapshots.loadFailed, error);
    } finally {
      if (token === this.loadToken) this.loading = false;
    }
  }

  /** Chọn một mốc và so với thư mục làm việc bây giờ. */
  async select(entry: SnapshotEntry): Promise<void> {
    this.selected = entry;
    const token = ++this.compareToken;
    this.comparing = true;
    try {
      const now = await this.snapshots.take('auto', { background: false });
      const files = await this.snapshots.changes(entry.sha, now.sha);
      if (token !== this.compareToken) return;
      this.comparison = { target: entry, now, files };
      await this.load();
    } catch (error) {
      if (token === this.compareToken) this.host.showError(vi.snapshots.loadFailed, error);
    } finally {
      if (token === this.compareToken) this.comparing = false;
    }
  }

  /** Diff của một file: mốc đã chọn → bây giờ, ở vùng giữa. */
  openFile(change: FileChange): void {
    const comparison = this.comparison;
    if (comparison === null) return;
    this.host.diff.open(change, { kind: 'commit', sha: comparison.now.sha, parent: comparison.target.sha });
  }

  /** Lần chụp tự động (bộ lập lịch): lỗi ném lên để bộ lập lịch quyết định thử lại; lần đầu trên máy thì giải thích. */
  async autoTake(): Promise<void> {
    await this.snapshots.take('auto');
    const prefs = this.host.prefs;
    if (!prefs.value.snapshotNoticeShown) {
      prefs.update({ snapshotNoticeShown: true });
      this.host.notify('info', vi.snapshots.firstNotice, {
        actions: [{ title: vi.snapshots.disableForRepo, run: () => this.setEnabledForRepo(false) }],
      });
    }
    if (this.isOpen) await this.load();
  }

  /** Dọn mốc cũ theo cài đặt (bộ lập lịch gọi tối đa mỗi giờ một lần). */
  async autoPrune(): Promise<void> {
    const value = this.host.prefs.value;
    const removed = await this.snapshots.prune({
      now: Math.floor(Date.now() / 1000),
      keepDays: value.snapshotKeepDays,
      keepCount: value.snapshotKeepCount,
    });
    if (removed > 0 && this.isOpen) await this.load();
  }

  async takeNow(): Promise<void> {
    try {
      await this.snapshots.take('manual', { background: false });
      this.host.notify('success', vi.snapshots.taken);
      if (this.isOpen) await this.load();
    } catch (error) {
      this.host.showError(vi.snapshots.takeFailed, error);
    }
  }

  /** Khôi phục `paths` (null = tất cả) về mốc đã chọn — hỏi trước, có Hoàn tác. */
  async restore(paths: readonly string[] | null, options: { dialogs?: DialogStore } = {}): Promise<void> {
    const comparison = this.comparison;
    if (comparison === null) return;
    const count = paths === null ? comparison.files.length : paths.length;
    if (count === 0) {
      this.host.notify('info', vi.snapshots.alreadySame);
      return;
    }
    const confirmed = await (options.dialogs ?? globalDialogs).confirm({
      title: vi.snapshots.restoreConfirmTitle(count),
      message: vi.snapshots.restoreConfirmMessage,
      confirmTitle: vi.snapshots.restoreConfirm,
      destructive: true,
    });
    if (!confirmed) return;

    const target = comparison.target;
    let before: SnapshotEntry | null = null;
    let restoredCount = 0;
    await this.host.perform(
      vi.snapshots.restoreTitle,
      async () => {
        const result = await this.snapshots.restore(target.sha, paths);
        before = result.before;
        restoredCount = result.restored.length + result.trashed.length;
      },
      {
        refresh: STATUS_SCOPE,
        onSuccess: () => {
          const undoPoint: SnapshotEntry | null = before;
          if (restoredCount === 0 || undoPoint === null) {
            this.host.notify('info', vi.snapshots.alreadySame);
            return;
          }
          this.host.notify('success', vi.snapshots.restored(restoredCount), {
            actions: [{ title: vi.snapshots.undo, run: () => void this.undo(undoPoint, paths) }],
          });
        },
      },
    );
    if (this.isOpen && this.selected?.sha === target.sha) await this.select(target);
  }

  private async undo(before: SnapshotEntry, paths: readonly string[] | null): Promise<void> {
    await this.host.perform(
      vi.snapshots.undoTitle,
      async () => {
        await this.snapshots.restore(before.sha, paths);
      },
      { refresh: STATUS_SCOPE, onSuccess: () => this.host.notify('success', vi.snapshots.undone) },
    );
    if (this.isOpen && this.selected !== null) await this.select(this.selected);
  }
}
