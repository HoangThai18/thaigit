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
  actionPick: 'Pick — keep as is',
  actionReword: 'Reword — edit message',
  actionSquash: 'Squash — combine, keep message',
  actionFixup: 'Fixup — combine, drop message',
  actionDrop: 'Drop — remove commit',
  squashInto: 'combined into the commit below',
  messageLabel: (sha: string) => `New message for ${sha}`,
  messageLoading: 'Reading commit message…',
  dragHandle: 'Drag to reorder',
  moveUp: 'Move up',
  moveDown: 'Move down',
  keysHint: 'Shortcuts: P pick · R reword · S squash · F fixup · D drop · Alt + ↑ / ↓ to move',
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
  menuReword: 'Edit commit message…',
  menuDrop: 'Drop this commit…',
  menuMove: 'Reorder',
  menuMoveUp: 'Move up (after the newer commit)',
  menuMoveDown: 'Move down (before the older commit)',
  rewordTitle: 'Edit commit message',
  rewordMessage: (sha: string) =>
    `Commit ${sha} and every commit after it on the branch will be rewritten (new SHAs). Ctrl + Enter to save.`,
  rewordField: 'Message',
  rewordConfirm: 'Save message',
  rewordDone: 'Commit message updated',
  dropTitle: (sha: string) => `Drop commit ${sha}?`,
  dropMessage: (subject: string, branch: string) =>
    `“${subject}” will be removed from ${branch} and the commits after it rewritten. You can undo right after.`,
  dropConfirm: 'Drop commit',
  dropDone: 'Commit dropped from the branch',
  moveDone: 'Commits reordered',
  alreadyNewest: 'This commit is already the newest on the branch.',
  alreadyOldest: 'There is no regular commit below to swap with.',
};
