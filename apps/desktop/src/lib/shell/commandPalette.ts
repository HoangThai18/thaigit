// Command palette (Ctrl/⌘ + P, port CommandPalette.swift): một ô gõ để tìm và chạy thao tác, checkout nhánh / tag, mở diff file
// đang thay đổi. Tìm không phân biệt hoa / thường và dấu; mọi từ gõ phải có mặt, khớp từ đầu tiêu đề được xếp trước.

import { fileChangeName, refName, type FileChange, type GitRef } from '@thaigit/core';
import { foldText } from '../format/natural.ts';
import type { MenuItem } from '../stores/menus.svelte.ts';
import type { IconName } from '../ui/icons.ts';

export type PaletteGroup = 'action' | 'branch' | 'tag' | 'file';

export interface PaletteItem {
  readonly group: PaletteGroup;
  readonly title: string;
  /** Dòng phụ (đường dẫn, remote…) — cũng được tìm. */
  readonly detail?: string;
  readonly icon: IconName;
  readonly shortcut?: string;
  /** Chữ thêm để tìm (vd. tên lệnh git tiếng Anh) — không hiển thị. */
  readonly keywords?: string;
  readonly run: () => void;
}

export const PALETTE_LIMIT = 80;

const GROUP_ORDER: Readonly<Record<PaletteGroup, number>> = { action: 0, branch: 1, tag: 2, file: 3 };

/** Mục menu (bỏ separator / tiêu đề / mục tắt; menu con trải phẳng thành "Cha › Con") → mục palette. */
export function menuToPalette(items: readonly MenuItem[], parent = ''): PaletteItem[] {
  const result: PaletteItem[] = [];
  for (const item of items) {
    if (item.kind === 'separator' || item.kind === 'header') continue;
    if (item.kind === 'submenu') {
      result.push(...menuToPalette(item.items, `${parent}${item.title} › `));
      continue;
    }
    if (item.disabled) continue;
    result.push({
      group: 'action',
      title: `${parent}${item.title}`,
      icon: item.icon ?? 'more',
      ...(item.shortcut ? { shortcut: item.shortcut } : {}),
      run: item.run,
    });
  }
  return result;
}

export function refToPalette(ref: GitRef, title: string, run: () => void): PaletteItem {
  return {
    group: ref.kind === 'tag' ? 'tag' : 'branch',
    title,
    detail: refName(ref),
    icon: ref.kind === 'tag' ? 'tag' : ref.kind === 'remoteBranch' ? 'cloud' : 'branch',
    keywords: 'checkout',
    run,
  };
}

export function fileToPalette(change: FileChange, title: string, run: () => void): PaletteItem {
  return {
    group: 'file',
    title,
    detail: change.path,
    icon: 'compare',
    keywords: fileChangeName(change),
    run,
  };
}

/**
 * Lọc + xếp hạng. Chưa gõ gì: chỉ các thao tác (đúng thứ tự khai báo). Có gõ: mọi từ phải nằm trong tiêu đề / dòng phụ / từ
 * khoá; tiêu đề bắt đầu bằng từ đầu tiên → hạng 0, một từ trong tiêu đề bắt đầu bằng nó → 1, còn lại → 2; rồi theo nhóm.
 */
export function filterPalette(query: string, items: readonly PaletteItem[]): PaletteItem[] {
  const text = foldText(query.trim());
  if (text === '') return items.filter((item) => item.group === 'action').slice(0, PALETTE_LIMIT);
  const words = text.split(/\s+/);
  const first = words[0] ?? '';
  const scored: { item: PaletteItem; rank: number; order: number }[] = [];
  items.forEach((item, order) => {
    const title = foldText(item.title);
    const haystack = `${title} ${foldText(item.detail ?? '')} ${foldText(item.keywords ?? '')}`;
    if (!words.every((word) => haystack.includes(word))) return;
    const rank = title.startsWith(first)
      ? 0
      : title.split(/[\s/›·—-]+/).some((part) => part.startsWith(first))
        ? 1
        : 2;
    scored.push({ item, rank, order });
  });
  return scored
    .sort(
      (a, b) => a.rank - b.rank || GROUP_ORDER[a.item.group] - GROUP_ORDER[b.item.group] || a.order - b.order,
    )
    .slice(0, PALETTE_LIMIT)
    .map((entry) => entry.item);
}
