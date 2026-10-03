// Lọc nhánh cho hộp "Chuyển nhánh" (port SwitchBranchSheet trong Sheets.swift): chưa gõ gì thì là các nhánh local gần đây;
// gõ thì tìm trong mọi nhánh local + remote (không phân biệt hoa / thường và dấu), nhánh local trước, khớp từ đầu tên trước.

import { refName, type GitRef } from '@thaigit/core';
import { foldText } from '../format/natural.ts';

export const RECENT_LIMIT = 40;
export const RESULT_LIMIT = 100;

/** Phần sau dấu `/` cuối của tên nhánh remote ("origin/feature/x" → "feature/x" khi remote là `origin`). */
function shortName(ref: GitRef, remotes: readonly string[]): string {
  const name = refName(ref);
  if (ref.kind !== 'remoteBranch') return name;
  const remote = [...remotes].sort((a, b) => b.length - a.length).find((item) => name.startsWith(`${item}/`));
  return remote ? name.slice(remote.length + 1) : name;
}

export function filterBranches(
  query: string,
  options: {
    recent: readonly GitRef[];
    local: readonly GitRef[];
    remote: readonly GitRef[];
    remotes: readonly string[];
  },
): GitRef[] {
  const text = foldText(query.trim());
  if (text === '') return options.recent.slice(0, RECENT_LIMIT);
  const words = text.split(/\s+/);
  const scored: { ref: GitRef; rank: number; order: number }[] = [];
  [...options.local, ...options.remote].forEach((ref, order) => {
    const name = foldText(refName(ref));
    if (!words.every((word) => name.includes(word))) return;
    const prefix = foldText(shortName(ref, options.remotes)).startsWith(words[0] ?? '');
    scored.push({ ref, rank: (ref.kind === 'localBranch' ? 0 : 2) + (prefix ? 0 : 1), order });
  });
  return scored
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, RESULT_LIMIT)
    .map((item) => item.ref);
}

/** Mặc định chọn nhánh khác nhánh hiện tại (Enter là chuyển ngay, giống `git checkout -`). */
export function defaultChoice(items: readonly GitRef[]): number {
  if (items.length === 0) return -1;
  const index = items.findIndex((ref) => !ref.isHead);
  return index < 0 ? 0 : index;
}
