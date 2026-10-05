/** English translation of `tab.vi.ts` (same keys, same parameters). */
import type { tabs as source } from './tabs.vi.ts';
import type { Translation } from './types.ts';

export const tabs: Translation<typeof source> = {
  label: 'Open repositories',
  newTab: 'New tab',
  newTabShortcut: 'Ctrl/⌘ + T',
  newWindowShortcut: 'Ctrl/⌘ + Shift + N',
  welcomeTitle: 'New tab',
  closeTab: 'Close tab',
  closeTabShortcut: 'Ctrl/⌘ + W',
  closeOthers: 'Close other tabs',
  closeNamed: (name: string) => `Close ${name}`,
  copyPath: 'Copy path',
  pathLabel: 'path',
  restoreFailed: (count: number) =>
    count === 1
      ? "Couldn't reopen 1 repository from last time"
      : `Couldn't reopen ${count} repositories from last time`,
};
