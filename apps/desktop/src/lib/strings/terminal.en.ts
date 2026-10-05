/** English translation of `termina.vi.ts` (same keys, same parameters). */
import type { terminal as terminalSource } from './terminal.vi.ts';
import type { Translation } from './types.ts';

export const terminal: Translation<typeof terminalSource> = {
  button: 'Terminal',
  buttonTip: 'Show / hide a terminal in the repository folder (Ctrl+`)',
  title: 'Terminal',
  titleNumbered: (index: number) => `Terminal ${index}`,
  newTab: 'New terminal tab',
  closeTab: "Close tab (stops this tab's shell)",
  hide: 'Hide terminal (Ctrl+`) — running commands keep going',
  resize: 'Drag to change the terminal height',
  unavailable: 'The terminal only runs inside the Thaigit app.',
};
