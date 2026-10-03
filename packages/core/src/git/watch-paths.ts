// Phân loại thay đổi bên trong thư mục .git (port RepoWatcher.classifyGitPath). Bản THAM CHIẾU: watcher của app chạy ở
// Rust (phase 2) và dùng cùng bảng luật này; bản TS giữ lại để test bảng luật và làm vector đối chiếu cho `cargo test`.

import { snapshotSpec, type RepoChangeKind } from '@thaigit/contracts';

const IGNORED_PREFIXES = [
  'objects/',
  'logs/',
  'lfs/',
  'hooks/',
  'info/',
  'modules/',
  'fsmonitor',
  'gc.',
  'FETCH_HEAD',
  'ORIG_HEAD.lock',
];

/** Thư mục ref snapshot per-worktree của app (`refs/worktree/thaigit/`). */
const SNAPSHOT_REF_DIR = snapshotSpec.ref.slice(0, snapshotSpec.ref.lastIndexOf('/') + 1);

/** `relative` là đường dẫn tương đối trong thư mục git (dùng `/`). Trả `[]` nếu không đáng làm mới UI. */
export function classifyGitPath(relative: string): RepoChangeKind[] {
  if (relative === '') return [];
  if (IGNORED_PREFIXES.some((prefix) => relative.startsWith(prefix))) return [];
  if (relative.endsWith('.lock')) return [];
  // Snapshot của app (kể cả của worktree khác thấy qua common dir) không phải thay đổi của người dùng.
  if (relative.startsWith(SNAPSHOT_REF_DIR) || relative.includes(`/${SNAPSHOT_REF_DIR}`)) return [];
  if (relative === 'index') return ['workingTree'];
  if (
    relative === 'HEAD' ||
    relative === 'packed-refs' ||
    relative.startsWith('refs/') ||
    relative.startsWith('rebase-') ||
    relative.endsWith('_HEAD') ||
    relative.startsWith('sequencer') ||
    relative === 'BISECT_LOG' ||
    relative.startsWith('worktrees/')
  ) {
    return ['refs', 'workingTree'];
  }
  return [];
}
