// Lối vào Lịch sử file / Blame dùng chung cho menu file, panel lịch sử và khung blame.

import { prefs } from '../stores/prefs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';

/** Mở lịch sử file ở panel phải (hiện panel nếu người dùng đang ẩn). */
export function openFileHistory(store: RepoStore, path: string): void {
  if (!prefs.value.showInspector) prefs.update({ showInspector: true });
  store.fileHistory.open(path);
}

/** Blame `path` ở vùng giữa; `rev` null = bản đang sửa trong working tree. */
export function openBlame(store: RepoStore, path: string, rev: string | null): void {
  store.blame.open(path, rev);
}

/** Quay về graph và chọn commit `sha` (đóng blame — nếu không graph vẫn bị che). */
export function showCommitInGraph(store: RepoStore, sha: string): void {
  store.diff.close();
  store.blame.close();
  store.reveal(sha);
}
