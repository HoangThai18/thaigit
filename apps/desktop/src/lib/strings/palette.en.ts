/** English translation of `palett.vi.ts` (same keys, same parameters). */
import type { palette as source } from './palette.vi.ts';
import type { Translation } from './types.ts';

export const palette: Translation<typeof source> = {
  title: 'Commands',
  open: 'Command palette…',
  shortcut: 'Ctrl/⌘ + P',
  placeholder: 'Type a command, branch, tag or file…',
  hint: '↑↓ select · Enter run · Esc close',
  empty: 'No matching commands',
  run: 'Run',
  pull: 'Pull (as in Settings)',
  checkoutBranch: (name: string) => `Check out ${name}`,
  checkoutTag: (name: string) => `Check out tag ${name}`,
  openDiff: (name: string) => `Show diff: ${name}`,
  groupBranch: 'Branch',
  groupTag: 'Tag',
  groupFile: 'File',
};
