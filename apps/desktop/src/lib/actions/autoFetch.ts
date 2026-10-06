// Background autofetch following the "autofetch every N minutes" preference (0 = off), like the Swift app: check every
// minute, skip while a window is hidden, while something is running, or when the last fetch / pull was less than N
// minutes ago. A failed fetch waits longer before retrying (backoff capped at one hour) so a flaky network does not
// cost a fetch every N minutes.

import type { RepoStore } from '../stores/repo.svelte.ts';
import { backgroundFetch } from './remote.ts';

const TICK_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** How long to wait before the next automatic retry after `failures` consecutive failures; 0 while healthy. */
export function backoffMs(failures: number, baseMs: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** failures);
}

export function shouldAutoFetch(store: RepoStore, now: number, hidden: boolean): boolean {
  const minutes = store.preferences.autoFetchMinutes;
  if (minutes <= 0 || hidden || store.busy !== null || store.remotes.length === 0) return false;
  return store.lastFetch === null || now - store.lastFetch >= minutes * 60_000;
}

/** Start autofetch for `store`; returns the stop function. */
export function startAutoFetch(store: RepoStore, tickMs = TICK_MS): () => void {
  let running = false;
  let failures = 0;
  let retryAt = 0;
  const timer = setInterval(() => {
    if (running) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!shouldAutoFetch(store, Date.now(), hidden)) return;
    const now = Date.now();
    if (now < retryAt) return;
    running = true;
    void backgroundFetch(store)
      .then((result) => {
        if (result === 'skipped') return;
        if (result === 'ok') {
          failures = 0;
          retryAt = 0;
        } else {
          failures += 1;
          const baseMs = Math.max(store.preferences.autoFetchMinutes, 1) * 60_000;
          retryAt = Date.now() + backoffMs(failures, baseMs);
        }
      })
      .finally(() => {
        running = false;
      });
  }, tickMs);
  return () => clearInterval(timer);
}
