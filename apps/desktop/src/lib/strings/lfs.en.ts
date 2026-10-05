/** English translation of `lf.vi.ts` (same keys, same parameters). */
import type { lfs as source } from './lfs.vi.ts';
import type { Translation } from './types.ts';

export const lfs: Translation<typeof source> = {
  section: 'GIT LFS',
  notInstalled: "Git LFS isn't installed — LFS files are only pointers",
  lockable: 'Must be locked before editing (lockable)',
  patternTitle: (pattern: string) => `Files matching ${pattern} are stored with Git LFS`,

  more: 'Git LFS actions',
  track: 'Track a new pattern with LFS…',
  untrack: 'Untrack from LFS',
  fetch: 'Fetch LFS files',
  pull: 'Pull LFS files',
  prune: 'Prune the LFS cache',
  fileMenu: 'Git LFS',
  trackExtension: (extension: string) => `Track all .${extension} files with LFS`,
  trackFile: 'Track just this file with LFS',

  trackTitle: 'Track with Git LFS',
  trackMessage:
    'Matching files are stored on the LFS server; the repository keeps only a small pointer. The pattern is written to .gitattributes — remember to commit it. Files committed earlier are not moved to LFS.',
  patternLabel: 'Pattern (e.g. *.psd, assets/**)',
  patternRequired: 'Enter a file pattern',
  patternInvalid: "The pattern can't start with - or contain line breaks",
  trackConfirm: 'Track',

  trackRunning: (pattern: string) => `Track ${pattern} with LFS`,
  tracked: (pattern: string) => `Now tracking ${pattern} with LFS — remember to commit .gitattributes`,
  untrackRunning: (pattern: string) => `Untrack ${pattern}`,
  untracked: (pattern: string) => `Stopped tracking ${pattern} — remember to commit .gitattributes`,
  fetchRunning: 'Fetch LFS files',
  fetched: 'Fetched LFS files',
  pullRunning: 'Pull LFS files',
  pulled: 'Pulled LFS files into the working tree',
  pruneRunning: 'Prune the LFS cache',
  pruned: 'Pruned the LFS cache',

  pointerTitle: 'Git LFS file',
  pointerMessage: (size: string) =>
    `In git this file is only a pointer to ${size} of content on the LFS server.`,
};
