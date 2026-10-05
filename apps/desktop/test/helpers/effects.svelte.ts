// Lets tests (a `.test.ts` file can't compile runes) run `$effect` outside a component: used by the `dom`
// suite, where Svelte loads the client build so the runes really are reactive.
import { flushSync } from 'svelte';
import { autoLoadMore, type LoadMoreSource } from '../../src/lib/graph/autoLoadMore.svelte.ts';

/** Wire GraphView's "load more when scrolling near the end" effect to a `rangeEnd` the test controls; returns a teardown function. */
export function mountAutoLoadMore(store: LoadMoreSource, rangeEnd: () => number): () => void {
  const stop = $effect.root(() => {
    autoLoadMore(() => store, rangeEnd);
  });
  flushSync();
  return stop;
}

/**
 * A deliberately "naive" fake store: each `loadMoreHistory()` just flips `isLoadingHistory` on then off and
 * the list never changes (like a failed load where the store doesn't block itself). GraphView's effect must
 * not call it again for the same list length.
 */
export class NaiveLoadMoreStore implements LoadMoreSource {
  mayHaveMoreCommits = $state(true);
  isLoadingHistory = $state(false);
  loadMoreFailed = $state(false);
  entries = $state.raw<LoadMoreSource['entries']>(Array.from({ length: 200 }, () => undefined as never));
  calls = 0;

  loadMoreHistory(): void {
    this.calls++;
    this.isLoadingHistory = true;
    setTimeout(() => (this.isLoadingHistory = false), 0);
  }
}

/** Count how many times a `$derived` reading `prefs.value.sidebarSections` / `columns` / `scheme` reports "changed" (dependent effects re-running). */
export function watchPrefs(prefs: {
  value: { sidebarSections: unknown; columns: unknown; scheme: unknown };
}) {
  const counts = { sections: 0, columns: 0, scheme: 0 };
  const stop = $effect.root(() => {
    const sections = $derived(prefs.value.sidebarSections);
    const columns = $derived(prefs.value.columns);
    const scheme = $derived(prefs.value.scheme);
    $effect(() => {
      void sections;
      counts.sections++;
    });
    $effect(() => {
      void columns;
      counts.columns++;
    });
    $effect(() => {
      void scheme;
      counts.scheme++;
    });
  });
  flushSync();
  return { counts, stop, flush: () => flushSync() };
}
