/** Hiển thị loại thay đổi file và màu avatar cho inspector — thuần, dùng chung cho commit/stash/WIP. */
import type { ChangeKind, FileChange } from '@thaigit/core';

export type ChangeTone = 'add' | 'modify' | 'delete' | 'rename' | 'warning' | 'muted';

/** Màu theo loại thay đổi (như `ChangeIcon` của Swift: thêm xanh lá, sửa cam, xoá đỏ, đổi tên xanh dương). */
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

/** Đếm cho dòng tóm tắt "＋ n ✎ n － n" (modified gồm đổi tên và đổi loại như Swift). */
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
 * Chỉ số màu avatar theo tên: djb2 trên scalar Unicode với số học Int 64-bit quấn vòng — đúng công thức của
 * `AvatarView` (Swift) nên cùng một người có cùng màu ở hai bản app. Có nhớ đệm theo tên.
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
