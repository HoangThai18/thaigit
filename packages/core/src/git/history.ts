// Dựng lịch sử đã xếp làn từ output `git log` — HÀM THUẦN (parse + chèn WIP + layout) để chạy trong Web Worker.
// Phần chạy git nằm ở `GitRepository.logBytes()` (main thread); hai bước không còn gói chung trong một lời gọi.

import { computeGraphLayout, type GraphRow } from '../graph/layout.ts';
import { workingTreeCommit, type Commit } from './models.ts';
import { parseLog } from './parsers.ts';

/** Lịch sử commit đã xếp làn, sẵn sàng để vẽ. */
export interface History {
  /** Có thể có commit giả WIP ở vị trí 0. */
  readonly commits: readonly Commit[];
  readonly rows: readonly GraphRow[];
  /** Số commit thật đã tải. */
  readonly loadedCount: number;
  /** true nếu có thể còn commit cũ hơn chưa tải (chạm giới hạn). */
  readonly mayHaveMore: boolean;
}

export interface BuildHistoryOptions {
  /** Giới hạn đã truyền cho `logBytes` (để biết còn commit cũ hơn hay không). */
  limit: number;
  /** Commit HEAD hiện tại: cha của node WIP (null nếu nhánh chưa có commit). */
  headOid: string | null;
  showWorkingTree: boolean;
}

export function buildHistory(log: Uint8Array | readonly Commit[], options: BuildHistoryOptions): History {
  const parsed = log instanceof Uint8Array ? parseLog(log) : log;
  const loadedCount = parsed.length;
  const commits = options.showWorkingTree ? [workingTreeCommit(options.headOid), ...parsed] : parsed;
  return {
    commits,
    rows: computeGraphLayout(commits),
    loadedCount,
    mayHaveMore: loadedCount >= options.limit,
  };
}
