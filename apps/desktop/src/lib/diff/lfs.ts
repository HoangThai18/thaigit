// Recognise the diff of a Git LFS pointer file (so DiffPane can note "the real content lives on the LFS server").

import { parseLfsPointer, type DiffPresentation, type LfsPointer } from '@thaigit/core';

/** LFS pointer on the new side (or the old side, when the file was deleted) of the diff — only a short single-hunk diff is considered, as in a pointer file. */
export function lfsPointerOf(presentation: DiffPresentation | null): LfsPointer | null {
  if (!presentation || presentation.hunks.length !== 1) return null;
  const lines = presentation.hunks[0]?.lines ?? [];
  if (lines.length > 12) return null;
  const side = (kind: 'addition' | 'deletion'): string =>
    lines
      .filter((line) => line.kind === 'context' || line.kind === kind)
      .map((line) => `${line.text}\n`)
      .join('');
  return parseLfsPointer(side('addition')) ?? parseLfsPointer(side('deletion'));
}
