// Tự lưu snapshot cho một cửa sổ repo: nối sự kiện "working tree đổi" của store vào bộ lập lịch. Khác tự fetch: cửa sổ ẩn vẫn
// chụp — agent AI thường sửa file đúng lúc app nằm nền. Mở repo cũng chụp một mốc (file có thể đã đổi lúc app đóng).

import { snapshotSpec } from '@thaigit/contracts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { SnapshotScheduler } from './scheduler.ts';

/** Bắt đầu tự lưu cho `store`; trả hàm dừng. */
export function startAutoSnapshots(store: RepoStore): () => void {
  const { quietMs, minIntervalMs, pruneIntervalMs } = snapshotSpec.defaults;
  const scheduler = new SnapshotScheduler({
    quietMs,
    minIntervalMs,
    pruneIntervalMs,
    enabled: () => store.timeline.enabled,
    busy: () => store.isPerforming,
    take: () => store.timeline.autoTake(),
    prune: () => store.timeline.autoPrune(),
  });
  const stopListening = store.onWorkingTreeChange(() => scheduler.notifyChange());
  scheduler.notifyChange();
  return () => {
    stopListening();
    scheduler.dispose();
  };
}
