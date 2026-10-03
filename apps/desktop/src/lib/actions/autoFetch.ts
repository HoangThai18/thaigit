// Tự fetch nền theo cài đặt "tự fetch mỗi N phút" (0 = tắt), như app Swift: kiểm mỗi phút, bỏ qua khi cửa sổ đang ẩn, đang
// bận, hoặc vừa fetch / pull chưa đủ N phút.

import type { RepoStore } from '../stores/repo.svelte.ts';
import { backgroundFetch } from './remote.ts';

const TICK_MS = 60_000;

export function shouldAutoFetch(store: RepoStore, now: number, hidden: boolean): boolean {
  const minutes = store.preferences.autoFetchMinutes;
  if (minutes <= 0 || hidden || store.busy !== null || store.remotes.length === 0) return false;
  return store.lastFetch === null || now - store.lastFetch >= minutes * 60_000;
}

/** Bắt đầu tự fetch cho `store`; trả hàm dừng. */
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
