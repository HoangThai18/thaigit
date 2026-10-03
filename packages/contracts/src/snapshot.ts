/**
 * Đặc tả snapshot (dòng thời gian working tree) dùng chung với app Swift: hằng đọc từ `snapshot.json`, định dạng message của
 * commit snapshot và luật dọn mốc cũ. Ca kiểm thử chung: `snapshot.vectors.json`.
 */
import spec from '../snapshot.json' with { type: 'json' };

export const SNAPSHOT_REASONS = ['auto', 'before-restore', 'manual'] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

export interface SnapshotSpec {
  version: number;
  /** Ref per-worktree; mỗi mốc là một mục reflog của nó. */
  ref: string;
  /** Index tạm, tương đối git dir của worktree. */
  indexFile: string;
  messageHeader: string;
  reflogMessage: string;
  identity: { name: string; email: string };
  reasons: readonly SnapshotReason[];
  defaults: {
    quietMs: number;
    minIntervalMs: number;
    keepDays: number;
    keepCount: number;
    pruneIntervalMs: number;
  };
}

export const snapshotSpec: SnapshotSpec = spec as SnapshotSpec;

export interface SnapshotMeta {
  reason: SnapshotReason;
  /** Số file khác HEAD lúc chụp; null khi thiếu hoặc không hợp lệ. */
  files: number | null;
}

/** Env danh tính cố định cho `commit-tree` (chính sách chỉ nhận đúng các giá trị này). */
export function snapshotIdentityEnv(): Record<string, string> {
  const { name, email } = snapshotSpec.identity;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

export function formatSnapshotMessage(reason: SnapshotReason, files: number): string {
  return `${snapshotSpec.messageHeader}\n\nreason: ${reason}\nfiles: ${files}\n`;
}

/** Message (%B) của commit snapshot → metadata; null nếu dòng đầu không đúng `messageHeader`. */
export function parseSnapshotMessage(message: string): SnapshotMeta | null {
  const lines = message.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines[0] !== snapshotSpec.messageHeader) return null;
  let reason: SnapshotReason = 'auto';
  let files: number | null = null;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'reason') {
      reason = (SNAPSHOT_REASONS as readonly string[]).includes(value) ? (value as SnapshotReason) : 'auto';
    } else if (key === 'files') {
      files = /^\d+$/.test(value) ? Number(value) : null;
    }
  }
  return { reason, files };
}

/**
 * Chỉ số mục reflog cần xoá (giảm dần — xoá từ cũ nhất để chỉ số các mục còn lại không đổi). `entries` có `index` = vị trí
 * trong reflog (0 = mới nhất) và `time` = giây. Mục 0 không bao giờ bị xoá; mục xoá khi `index >= keepCount` hoặc cũ hơn
 * `keepDays` ngày (mốc ở tương lai do lệch đồng hồ thì giữ).
 */
export function selectExpiredSnapshots(
  entries: readonly { index: number; time: number }[],
  now: number,
  keepDays: number,
  keepCount: number,
): number[] {
  const maxAge = keepDays * 86_400;
  return entries
    .filter((entry) => entry.index > 0 && (entry.index >= keepCount || now - entry.time > maxAge))
    .map((entry) => entry.index)
    .sort((a, b) => b - a);
}
