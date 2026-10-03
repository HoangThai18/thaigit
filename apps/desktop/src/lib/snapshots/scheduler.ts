// Lập lịch chụp snapshot tự động: working tree đổi → chờ file yên `quietMs` (mỗi thay đổi mới đẩy lùi), không chụp dày hơn
// `minIntervalMs`, bỏ qua khi tắt cho repo, thử lại khi repo bận. Sau lần chụp đầu và tối đa mỗi `pruneIntervalMs` thì dọn
// mốc cũ. Không phụ thuộc Svelte để test bằng đồng hồ giả.

import { AdapterError } from '@thaigit/core';

export interface SchedulerDeps {
  quietMs: number;
  minIntervalMs: number;
  pruneIntervalMs: number;
  /** Snapshot đang bật cho repo này (cài đặt chung + theo repo). */
  enabled(): boolean;
  /** App đang chạy thao tác ghi trên repo (đợi xong rồi chụp). */
  busy(): boolean;
  take(): Promise<void>;
  prune(): Promise<void>;
}

function isBusy(error: unknown): boolean {
  return error instanceof AdapterError && error.code === 'busy';
}

export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private running = false;
  private disposed = false;
  private lastTakenAt = Number.NEGATIVE_INFINITY;
  private lastPrunedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: SchedulerDeps) {}

  /** Working tree vừa đổi (sự kiện watcher), hoặc vừa mở repo. */
  notifyChange(): void {
    if (this.disposed) return;
    this.dirty = true;
    this.schedule(this.deps.quietMs);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(quietMs: number): void {
    clearTimeout(this.timer);
    const due = Math.max(Date.now() + quietMs, this.lastTakenAt + this.deps.minIntervalMs);
    this.timer = setTimeout(() => void this.fire(), Math.max(0, due - Date.now()));
  }

  private async fire(): Promise<void> {
    this.timer = undefined;
    if (this.disposed || !this.dirty || this.running) return;
    if (!this.deps.enabled()) {
      this.dirty = false;
      return;
    }
    if (this.deps.busy()) {
      this.schedule(this.deps.quietMs);
      return;
    }
    this.running = true;
    this.dirty = false;
    try {
      await this.deps.take();
      this.lastTakenAt = Date.now();
      if (Date.now() - this.lastPrunedAt >= this.deps.pruneIntervalMs) {
        this.lastPrunedAt = Date.now();
        await this.deps.prune().catch(() => undefined);
      }
    } catch (error) {
      if (isBusy(error)) {
        this.dirty = true;
      } else {
        // Lỗi khác (repo hỏng, git thiếu…): bỏ lần này; khoảng tối thiểu tránh thử lại dồn dập.
        this.lastTakenAt = Date.now();
      }
    } finally {
      this.running = false;
    }
    if (this.dirty && !this.disposed) this.schedule(this.deps.quietMs);
  }
}
