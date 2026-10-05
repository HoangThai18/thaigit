/** File change-kind display and avatar colour for the inspector — pure, shared by commit / stash / WIP. */
import type { ChangeKind, FileChange } from '@thaigit/core';

export type ChangeTone = 'add' | 'modify' | 'delete' | 'rename' | 'warning' | 'muted';

/** Colour per change kind (like Swift's `ChangeIcon`: added green, modified amber, deleted red, renamed blue). */
export function changeTone(kind: ChangeKind): ChangeTone {
  switch (kind) {
    case 'added':
    case 'untracked':
      return 'add';
    case 'modified':
    case 'typeChanged':
      return 'modify';
    case 'deleted':
      return 'delete';
    case 'renamed':
    case 'copied':
      return 'rename';
    case 'conflicted':
      return 'warning';
    case 'unknown':
      return 'muted';
  }
}

export interface ChangeSummary {
  added: number;
  modified: number;
  deleted: number;
}

/** Counts for the summary line "＋ n ✎ n － n" (modified includes renames and kind changes, like Swift). */
export function summarizeChanges(files: readonly FileChange[]): ChangeSummary {
  const summary: ChangeSummary = { added: 0, modified: 0, deleted: 0 };
  for (const file of files) {
    if (file.kind === 'added' || file.kind === 'untracked') summary.added++;
    else if (file.kind === 'modified' || file.kind === 'renamed' || file.kind === 'typeChanged')
      summary.modified++;
    else if (file.kind === 'deleted') summary.deleted++;
  }
  return summary;
}

const avatarColors = new Map<string, number>();

/**
 * Avatar colour index from a name: djb2 over Unicode scalar values with wrapping 64-bit Int arithmetic —
 * the exact formula of `AvatarView` (Swift) so the same person gets the same colour in both apps.
 * Memoised per name.
 */
export function avatarColorIndex(name: string, paletteSize = 12): number {
  const key = `${paletteSize}:${name}`;
  const cached = avatarColors.get(key);
  if (cached !== undefined) return cached;
  let hash = 5381n;
  for (const symbol of name) {
    hash = BigInt.asIntN(64, BigInt.asIntN(64, hash << 5n) + hash);
    hash = BigInt.asIntN(64, hash + BigInt(symbol.codePointAt(0) ?? 0));
  }
  const magnitude = hash < 0n ? -hash : hash;
  const index = Number(magnitude % BigInt(paletteSize));
  avatarColors.set(key, index);
  return index;
}
