/** English translation of `histor.vi.ts` (same keys, same parameters). */
import type { history as source } from './history.vi.ts';
import type { Translation } from './types.ts';

export const history: Translation<typeof source> = {
  menuFileHistory: 'File history',
  menuBlame: 'Blame — who changed each line',
  menuBlameAtCommit: 'Blame at this commit',

  title: 'File history',
  close: 'Close file history',
  loading: 'Reading history…',
  loadFailed: 'Couldn’t read the file history',
  empty: 'This file isn’t in any commit yet.',
  commits: (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`,
  limited: (count: number) => `Showing the latest ${count} commits only.`,
  renamedFrom: (oldPath: string) => `renamed from ${oldPath}`,
  deleted: 'deleted',
  added: 'created',
  showInGraph: 'Show in graph',
  openDiff: 'Show changes to this file',
  blameHere: 'Blame at this commit',
  blameCurrent: 'Blame current version',

  blameLabel: 'Blame',
  blameWorkingTree: 'Current version (including uncommitted changes)',
  blameAtCommit: (sha: string) => `At ${sha}`,
  blameLoading: 'Running blame…',
  blameFailed: 'Couldn’t blame this file',
  blameEmpty: 'The file is empty.',
  blameRetry: 'Try again',
  uncommitted: 'Not committed',
  uncommittedTip: 'A line you’re editing that isn’t committed yet',
  lineTip: (sha: string, author: string, time: string, summary: string) =>
    `${sha} · ${author} · ${time}\n${summary}\nClick to show the commit in the graph`,
  openHistory: 'File history',
};
