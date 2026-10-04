/** Bản tiếng Anh của `rebase.vi.ts` (cùng khoá, cùng tham số). */
import type { rebase as source } from './rebase.vi.ts';
import type { Translation } from './types.ts';

export const rebase: Translation<typeof source> = {
  menu: 'Interactive rebase from here…',
  title: (branch: string) => `Interactive rebase ${branch}`,
  subtitle: (count: number, sha: string, subject: string) =>
    `${count} ${count === 1 ? 'commit' : 'commits'} after ${sha} “${subject}”. Newest on top — drag to reorder.`,
  listLabel: 'Commits to rewrite',
  actionLabel: (sha: string) => `Action for commit ${sha}`,
  actionPick: 'Pick',
  actionReword: 'Reword',
  actionSquash: 'Squash',
  actionFixup: 'Fixup',
  actionDrop: 'Drop',
  squashInto: 'combined into the commit below',
  messageLabel: (sha: string) => `New message for ${sha}`,
  messageLoading: 'Reading commit message…',
  dragHandle: 'Drag to reorder',
  moveUp: 'Move up (after the commit above)',
  moveDown: 'Move down (before the commit below)',
  keysHint: 'Keys on a row: P pick · R reword · S squash · F fixup · D drop · Alt + ↑ / ↓ move',
  reset: 'Reset',
  start: 'Start rebase',
  cancel: 'Cancel',

  problemEmpty: 'There are no commits to rebase.',
  problemMerge: 'This range contains a merge commit — Thaigit can’t interactively rebase across merges yet.',
  problemLeadingSquash:
    'The bottom remaining commit can’t be squashed (there’s no commit below it to combine into).',
  problemEmptyMessage: 'The new commit message can’t be empty.',
  problemAllDropped: 'You can’t drop every commit — use Reset to move the branch back to the base commit.',
  problemUnchanged: 'Nothing has changed yet.',

  needBranch: 'Switch to a branch to rebase interactively',
  operationInProgress:
    'The repository has an operation in progress (merge, rebase…) — continue or abort it first.',
  notOnBranch: (sha: string) => `Commit ${sha} isn’t on the current branch, so you can’t rebase from it.`,
  nothingAfter: 'There are no commits after this one on the current branch.',
  loadFailed: 'Couldn’t read the commits to rebase',
  running: (branch: string) => `Interactive rebase ${branch}`,
  done: (branch: string) => `Rebased ${branch}`,
  autostashConflict:
    'Rebased, but bringing back your uncommitted changes caused conflicts — your changes are still in the stash.',
};
