// Automatic snapshots for one repo window: wires the store's "working tree changed" event into the
// scheduler. Unlike auto-fetch, hidden windows still capture — an AI agent often edits files exactly while
// the app is in the background. Opening a repo also captures a milestone (the files may have changed while
// the app was closed).

import { snapshotSpec } from '@thaigit/contracts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { SnapshotScheduler } from './scheduler.ts';

/** Start auto-capture for `store`; returns a stop function. */
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
