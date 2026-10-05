/** English translation of `dn.vi.ts` (same keys, same parameters). */
import type { dnd as source } from './dnd.vi.ts';
import type { Translation } from './types.ts';

export const dnd: Translation<typeof source> = {
  mergeInto: (source: string, target: string) => `Merge ${source} into ${target}`,
  checkoutAndMerge: (source: string, target: string) => `Checkout ${target}, then merge ${source} into it`,
  rebaseOnto: (source: string, target: string) => `Rebase ${source} onto ${target}`,
  fastForward: (target: string, source: string) => `Fast-forward ${target} to ${source}`,
  pushTo: (source: string, target: string) => `Push ${source} to ${target}`,
  pushTagTo: (tag: string, remote: string) => `Push tag ${tag} to ${remote}`,
  noTagDrop: 'Nothing happens when dropping on a tag',
  files: (count: number) => (count === 1 ? '1 file' : `${count} files`),
  hintRef: 'Drop on a branch to merge / rebase, on a remote to push',
  hintStage: 'Drop into “Staged” to stage',
  hintUnstage: 'Drop into “Unstaged” to unstage',
};
