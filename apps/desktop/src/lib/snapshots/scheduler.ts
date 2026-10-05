// Schedules automatic snapshot capture: working tree changed → wait for `quietMs` of stillness (every new
// change pushes it back), never capture more often than `minIntervalMs`, skip when disabled for this repo,
// retry when the repo is busy. After the first capture, and at most every `pruneIntervalMs`, old milestones
// are pruned. Independent of Svelte so tests can drive it with a fake clock.

import { AdapterError } from '@thaigit/core';

export interface SchedulerDeps {
  quietMs: number;
  minIntervalMs: number;
  pruneIntervalMs: number;
  /** Snapshots are on for this repo (global setting + per-repo override). */
  enabled(): boolean;
  /** The app is running a write operation on the repo (wait for it, then capture). */
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

  /** The working tree just changed (watcher event), or the repo was just opened. */
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
        // Other failures (broken repo, missing git…): skip this round; the minimum interval prevents a rapid retry storm.
        this.lastTakenAt = Date.now();
      }
    } finally {
      this.running = false;
    }
    if (this.dirty && !this.disposed) this.schedule(this.deps.quietMs);
  }
}
