// Background autofetch following the "autofetch every N minutes" preference (0 = off), like the Swift app: check every
// minute, skip while a window is hidden, while something is running, or when the last fetch / pull was less than N minutes ago.

import type { RepoStore } from '../stores/repo.svelte.ts';
import { backgroundFetch } from './remote.ts';

const TICK_MS = 60_000;

export function shouldAutoFetch(store: RepoStore, now: number, hidden: boolean): boolean {
  const minutes = store.preferences.autoFetchMinutes;
  if (minutes <= 0 || hidden || store.busy !== null || store.remotes.length === 0) return false;
  return store.lastFetch === null || now - store.lastFetch >= minutes * 60_000;
}

/** Start autofetch for `store`; returns the stop function. */
export function startAutoFetch(store: RepoStore, tickMs = TICK_MS): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!shouldAutoFetch(store, Date.now(), hidden)) return;
    running = true;
    void backgroundFetch(store).finally(() => {
      running = false;
    });
  }, tickMs);
  return () => clearInterval(timer);
}
