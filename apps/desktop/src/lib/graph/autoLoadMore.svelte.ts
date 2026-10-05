/**
 * Load more history when scrolling near the end of the graph (like Swift: ≤ 30 rows left). Must be called
 * during component initialisation (use `$effect`).
 *
 * Only ONE request per list length: a failed load (or one that adds no rows) leaves `entries.length`
 * unchanged, so without this guard every time `isLoadingHistory` flips the effect would run again and
 * invoke `git log` once more — forever. Only a list that actually grew (a successful load) may ask
 * again. The store also blocks further attempts itself via `loadMoreFailed` (only a user action retries).
 */
import { untrack } from 'svelte';
import type { RepoStore } from '../stores/repo.svelte.ts';

export type LoadMoreSource = Pick<
  RepoStore,
  'mayHaveMoreCommits' | 'isLoadingHistory' | 'loadMoreFailed' | 'entries' | 'loadMoreHistory'
>;

export function autoLoadMore(getStore: () => LoadMoreSource, rangeEnd: () => number, margin = 30): void {
  let requestedFor = -1;
  $effect(() => {
    const store = getStore();
    const total = store.entries.length;
    const end = rangeEnd();
    if (!store.mayHaveMoreCommits || store.isLoadingHistory || store.loadMoreFailed) return;
    if (end <= 0 || end < total - margin || requestedFor === total) return;
    requestedFor = total;
    untrack(() => store.loadMoreHistory());
  });
}
