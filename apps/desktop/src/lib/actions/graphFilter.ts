// Hide branches on the graph, or restrict it to "solo" (a port of RepoModel+GraphFilter.swift). Hiding or soloing a local branch
// also hides the remote branch tracking it (otherwise the history would still show through the remote branch). The checked-out branch is always shown.

import { refFilterActive, refName, type GitRef, type GraphRefFilter } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import type { MenuItem } from '../stores/menus.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';

function namesFor(store: RepoStore, ref: GitRef): string[] {
  const names = [ref.fullName];
  if (ref.kind === 'localBranch' && ref.upstream !== null) {
    const remote = store.remoteBranches.find((candidate) => refName(candidate) === ref.upstream);
    if (remote) names.push(remote.fullName);
  }
  return names;
}

const without = (list: readonly string[], names: readonly string[]): string[] =>
  list.filter((name) => !names.includes(name));
const withAll = (list: readonly string[], names: readonly string[]): string[] => [
  ...without(list, names),
  ...names,
];

/** The checked-out branch (and the remote branch it tracks) cannot be hidden. */
export function canHideOnGraph(store: RepoStore, ref: GitRef): boolean {
  if (ref.kind === 'tag') return false;
  if (ref.kind === 'localBranch') return !ref.isHead;
  return store.localBranches.find((branch) => branch.isHead)?.upstream !== refName(ref);
}

export function toggleHidden(store: RepoStore, ref: GitRef): void {
  if (ref.kind === 'tag') return;
  const filter = store.graphFilter;
  const names = namesFor(store, ref);
  if (filter.hidden.includes(ref.fullName)) {
    store.setGraphFilter({ ...filter, hidden: without(filter.hidden, names) });
    return;
  }
  if (!canHideOnGraph(store, ref)) {
    store.notify('info', vi.graph.cannotHideCurrent);
    return;
  }
  const next: GraphRefFilter = { hidden: withAll(filter.hidden, names), solo: without(filter.solo, names) };
  store.setGraphFilter(next);
  store.notify('info', vi.graph.hidden(refName(ref)), {
    tag: 'graph-filter',
    actions: [
      {
        title: vi.staging.undo,
        run: () =>
          store.setGraphFilter({ ...store.graphFilter, hidden: without(store.graphFilter.hidden, names) }),
      },
    ],
  });
}

export function toggleSolo(store: RepoStore, ref: GitRef): void {
  if (ref.kind === 'tag') return;
  const filter = store.graphFilter;
  const names = namesFor(store, ref);
  if (filter.solo.includes(ref.fullName))
    store.setGraphFilter({ ...filter, solo: without(filter.solo, names) });
  else store.setGraphFilter({ hidden: without(filter.hidden, names), solo: withAll(filter.solo, names) });
}

export function showAllBranches(store: RepoStore): void {
  store.setGraphFilter({ hidden: [], solo: [] });
}

/** The description for the graph's hint bar; `null` when nothing is filtered. */
export function graphFilterSummary(store: RepoStore): string | null {
  const existing = new Set(store.refs.map((ref) => ref.fullName));
  const hidden = store.graphFilter.hidden.filter((name) => existing.has(name));
  const solo = store.graphFilter.solo.filter((name) => existing.has(name));
  if (!refFilterActive({ hidden, solo })) return null;
  // Counted by the branch the user picked: a remote branch coming along with its local one is not counted again.
  const count = (names: readonly string[]): number => {
    const paired = new Set(
      store.localBranches.filter((ref) => names.includes(ref.fullName)).map((ref) => ref.upstream),
    );
    return names.filter((name) => {
      const ref = store.refs.find((candidate) => candidate.fullName === name);
      return !(ref?.kind === 'remoteBranch' && paired.has(refName(ref)));
    }).length;
  };
  return solo.length > 0 ? vi.graph.soloSummary(count(solo)) : vi.graph.hiddenSummary(count(hidden));
}

export function graphFilterItems(store: RepoStore, ref: GitRef): MenuItem[] {
  if (ref.kind === 'tag') return [];
  const filter = store.graphFilter;
  const hidden = filter.hidden.includes(ref.fullName);
  const solo = filter.solo.includes(ref.fullName);
  const items: MenuItem[] = [
    {
      title: hidden ? vi.graph.showOnGraph : vi.graph.hideOnGraph,
      icon: hidden ? 'eye' : 'eye-off',
      disabled: !hidden && !canHideOnGraph(store, ref),
      run: () => toggleHidden(store, ref),
    },
    { title: solo ? vi.graph.unsolo : vi.graph.solo, icon: 'filter', run: () => toggleSolo(store, ref) },
  ];
  if (refFilterActive(filter))
    items.push({ title: vi.graph.showAll, icon: 'eye', run: () => showAllBranches(store) });
  return items;
}
