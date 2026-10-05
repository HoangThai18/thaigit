// Command palette (Ctrl/⌘ + P, a port of CommandPalette.swift): one input to find and run actions, check out
// branches / tags, and open the diff of a changed file. Search ignores case and diacritics; every typed
// word must be present, and title-prefix matches rank first.

import { fileChangeName, refName, type FileChange, type GitRef } from '@thaigit/core';
import { foldText } from '../format/natural.ts';
import type { MenuItem } from '../stores/menus.svelte.ts';
import type { IconName } from '../ui/icons.ts';

export type PaletteGroup = 'action' | 'branch' | 'tag' | 'file';

export interface PaletteItem {
  readonly group: PaletteGroup;
  readonly title: string;
  /** Sub-line (path, remote…) — also searched. */
  readonly detail?: string;
  readonly icon: IconName;
  readonly shortcut?: string;
  /** Extra searchable words (e.g. an English git command name) — not displayed. */
  readonly keywords?: string;
  readonly run: () => void;
}

export const PALETTE_LIMIT = 80;

const GROUP_ORDER: Readonly<Record<PaletteGroup, number>> = { action: 0, branch: 1, tag: 2, file: 3 };

/** Menu items (separators / headers / disabled entries dropped; submenus flattened to "Parent › Child") → palette items. */
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
 * Filter + rank. Nothing typed: only the actions, in declaration order. With input: every word must appear
 * in the title / sub-line / keywords; a title starting with the first word → rank 0, a title containing it
 * → 1, anything else → 2; then by group.
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
