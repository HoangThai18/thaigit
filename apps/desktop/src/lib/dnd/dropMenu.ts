// What dropping X onto Y does (a port of `dropOptions` in RepoModel+Actions.swift): branch onto branch (merge /
// rebase / fast-forward), branch onto a remote branch or a remote (push), tag onto a remote (push tag); a
// file between "Unstaged" ↔ "Staged" (staged / unstaged immediately, no prompt). Anything involving a
// branch always goes through a confirmation menu — nothing runs behind the user's back.

import { refName, type GitRef } from '@thaigit/core';
import { switchToBranch, fastForward } from '../actions/branches.ts';
import { merge, rebase, rebaseCurrent } from '../actions/history.ts';
import { performPush } from '../actions/remote.ts';
import { stageFiles, unstageFiles } from '../actions/staging.ts';
import { pushTag } from '../actions/tags.ts';
import { vi } from '../strings.vi.ts';
import type { MenuItem } from '../stores/menus.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import type { DragPayload, DropTarget } from './drag.svelte.ts';

function findRef(store: RepoStore, fullName: string): GitRef | undefined {
  return (
    store.localBranches.find((ref) => ref.fullName === fullName) ??
    store.remoteBranches.find((ref) => ref.fullName === fullName) ??
    store.tags.find((ref) => ref.fullName === fullName)
  );
}

/** Merge `source` into `target`; when `target` isn't the current branch, check it out first. */
async function mergeInto(store: RepoStore, source: string, target: string): Promise<void> {
  if (store.currentBranch !== target) {
    await switchToBranch(store, target);
    if (store.currentBranch !== target) return;
  }
  await merge(store, source, source);
}

/** The options when dropping branch / tag `source` onto `target` (empty = do nothing). */
export function refDropItems(store: RepoStore, source: GitRef, target: DropTarget): MenuItem[] {
  const sourceName = refName(source);
  const current = store.currentBranch;
  const items: MenuItem[] = [];
  if (target.kind === 'remote') {
    if (source.kind === 'localBranch') {
      items.push({
        title: vi.dnd.pushTo(sourceName, target.name),
        icon: 'push',
        run: () =>
          void performPush(store, {
            localBranch: sourceName,
            remote: target.name,
            remoteBranch: sourceName,
            setUpstream: source.upstream === null,
            force: false,
          }),
      });
    } else if (source.kind === 'tag') {
      items.push({
        title: vi.dnd.pushTagTo(sourceName, target.name),
        icon: 'push',
        run: () => void pushTag(store, source, target.name),
      });
    }
    return items;
  }
  if (target.kind !== 'ref' || target.fullName === source.fullName) return items;
  const ref = findRef(store, target.fullName);
  if (!ref) return items;
  const targetName = refName(ref);
  if (ref.kind === 'localBranch') {
    items.push({
      title:
        current === targetName
          ? vi.dnd.mergeInto(sourceName, targetName)
          : vi.dnd.checkoutAndMerge(sourceName, targetName),
      icon: 'merge',
      run: () => void mergeInto(store, sourceName, targetName),
    });
    if (source.kind === 'localBranch') {
      items.push({
        title: vi.dnd.rebaseOnto(sourceName, targetName),
        icon: 'rebase',
        run: () => void rebase(store, sourceName, targetName, targetName, sourceName !== current),
      });
    }
    if (source.kind === 'remoteBranch' && ref.upstream === sourceName && ref.behind > 0 && ref.ahead === 0) {
      items.push({
        title: vi.dnd.fastForward(targetName, sourceName),
        icon: 'fast-forward',
        run: () => void fastForward(store, ref),
      });
    }
  } else if (ref.kind === 'remoteBranch') {
    const split = store.splitUpstream(targetName);
    if (source.kind === 'localBranch' && split) {
      items.push({
        title: vi.dnd.pushTo(sourceName, targetName),
        icon: 'push',
        run: () =>
          void performPush(store, {
            localBranch: sourceName,
            remote: split.remote,
            remoteBranch: split.branch,
            setUpstream: source.upstream === null,
            force: false,
          }),
      });
    }
    if (source.kind === 'localBranch' && sourceName === current) {
      items.push({
        title: vi.dnd.rebaseOnto(sourceName, targetName),
        icon: 'rebase',
        run: () => void rebaseCurrent(store, targetName, targetName),
      });
    }
  } else if (ref.kind === 'tag') {
    items.push({ title: vi.dnd.noTagDrop, disabled: true, run: () => {} });
  }
  return items;
}

export function canDrop(store: RepoStore, payload: DragPayload, target: DropTarget): boolean {
  if (store.busy !== null) return false;
  if (payload.kind === 'files') {
    return target.kind === 'zone' && target.zone !== payload.from;
  }
  if (target.kind === 'zone') return false;
  return refDropItems(store, payload.ref, target).some((item) => !('disabled' in item && item.disabled));
}

/** After a drop: files act immediately; branches / tags return the menu so the user chooses. */
export function dropAction(store: RepoStore, payload: DragPayload, target: DropTarget): MenuItem[] | null {
  if (payload.kind === 'files') {
    if (target.kind !== 'zone' || target.zone === payload.from) return null;
    if (payload.from === 'unstaged') void stageFiles(store, payload.changes);
    else void unstageFiles(store, payload.changes);
    return null;
  }
  return refDropItems(store, payload.ref, target);
}
