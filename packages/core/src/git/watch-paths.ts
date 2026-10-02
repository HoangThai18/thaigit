// Phân loại thay đổi bên trong thư mục .git (port RepoWatcher.classifyGitPath). Bản THAM CHIẾU: watcher của app chạy ở
// Rust (phase 2) và dùng cùng bảng luật này; bản TS giữ lại để test bảng luật và làm vector đối chiếu cho `cargo test`.

import type { RepoChangeKind } from '@thaigit/contracts';

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

/** `relative` là đường dẫn tương đối trong thư mục git (dùng `/`). Trả `[]` nếu không đáng làm mới UI. */
export function classifyGitPath(relative: string): RepoChangeKind[] {
  if (relative === '') return [];
  if (IGNORED_PREFIXES.some((prefix) => relative.startsWith(prefix))) return [];
  if (relative.endsWith('.lock')) return [];
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
