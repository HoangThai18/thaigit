// Nhận diện diff của một file con trỏ Git LFS (để DiffPane ghi chú "nội dung thật nằm trên máy chủ LFS").

import { parseLfsPointer, type DiffPresentation, type LfsPointer } from '@thaigit/core';

/** Con trỏ LFS ở bản mới (hoặc bản cũ, khi file bị xoá) của diff — chỉ xét diff một hunk ngắn như file con trỏ. */
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
