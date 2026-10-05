/** English translation of `snapshot.vi.ts` (same keys, same parameters). */
import type { snapshots as source } from './snapshots.vi.ts';
import type { Translation } from './types.ts';

const files = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;

export const snapshots: Translation<typeof source> = {
  title: 'Timeline',
  open: 'Timeline…',
  openHint: 'Snapshots Thaigit saves of your working folder — go back when something breaks',
  close: 'Close timeline',
  intro:
    'Thaigit saves your working folder whenever files change, including uncommitted ones. Pick a snapshot to see how it differs from now, then restore.',
  empty: 'No snapshots yet. Thaigit saves one when files in this repo change.',
  loading: 'Reading the timeline…',
  loadFailed: 'Couldn’t read the timeline',
  takeNow: 'Save a snapshot now',
  takeFailed: 'Couldn’t save a snapshot',
  taken: 'Snapshot saved',

  disabledForRepo: 'Automatic snapshots are off for this repo.',
  enableForRepo: 'Turn back on',
  disableForRepo: 'Turn off for this repo',
  disabledGlobally: 'Automatic snapshots are off in Settings.',

  reasonAuto: 'Automatic',
  reasonBeforeRestore: 'Before restore',
  reasonManual: 'Manual',
  filesVsHead: (count: number) => `${files(count)} ${count === 1 ? 'differs' : 'differ'} from HEAD`,

  compareTitle: 'Differences from now',
  comparing: 'Comparing with now…',
  noDifference: 'Your working folder matches this snapshot.',
  restoreFile: 'Restore this file',
  restoreAll: 'Restore everything to this snapshot',
  restoreConfirmTitle: (count: number) => `Restore ${files(count)} to this snapshot?`,
  restoreConfirmMessage:
    'Your current working folder is saved as a snapshot before anything is overwritten, so you can undo. Files created after this snapshot are moved to Thaigit’s trash. Staged changes stay as they are.',
  restoreConfirm: 'Restore',
  restoreTitle: 'Restore from timeline',
  restored: (count: number) => `Restored ${files(count)}`,
  alreadySame: 'Your working folder already matches this snapshot.',
  undo: 'Undo',
  undoTitle: 'Undo restore',
  undone: 'Your working folder is back to how it was before the restore',

  firstNotice:
    'Thaigit will save your working folder when files change so you can go back if your code breaks (Timeline, in the changes panel). Snapshots stay on this computer and are never pushed.',

  settingsTitle: 'Timeline',
  settingsEnabled: 'Save the working folder automatically when files change',
  settingsHelp:
    'Snapshots live in each repo’s .git folder (a hidden per-worktree ref) and are never pushed. Turn them off for a single repo in the Timeline panel.',
  keepDays: 'Keep snapshots for (days)',
  keepCount: 'Maximum snapshots per repo',
};
