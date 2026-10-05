// Entry points into File history / Blame shared by the file menu, the history panel and the blame frame.

import { prefs } from '../stores/prefs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';

/** Open file history in the right panel (showing it if the user has it hidden). */
export function openFileHistory(store: RepoStore, path: string): void {
  if (!prefs.value.showInspector) prefs.update({ showInspector: true });
  store.fileHistory.open(path);
}

/** Blame `path` in the centre area; a `null` `rev` means the version being edited in the working tree. */
export function openBlame(store: RepoStore, path: string, rev: string | null): void {
  store.blame.open(path, rev);
}

/** Return to the graph and select commit `sha` (this closes blame — otherwise the graph stays covered). */
export function showCommitInGraph(store: RepoStore, sha: string): void {
  store.diff.close();
  store.blame.close();
  store.reveal(sha);
}
