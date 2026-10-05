// Lưu bộ lọc nhánh trên graph (ẩn / solo) theo repo trong localStorage của webview. Dữ liệu đọc ra luôn được kiểm lại.

import { NO_REF_FILTER, refFilterActive, type GraphRefFilter } from '@thaigit/core';
import { browserStorage, type KeyValueStorage } from '../stores/prefs.svelte.ts';

const PREFIX = 'thaigit.graphFilter.v1:';

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.startsWith('refs/'))
        .slice(0, 500)
    : [];
}

export function loadGraphFilter(
  root: string,
  storage: KeyValueStorage | null = browserStorage(),
): GraphRefFilter {
  try {
    const text = storage?.getItem(PREFIX + root);
    if (!text) return NO_REF_FILTER;
    const raw = JSON.parse(text) as Record<string, unknown>;
    return { hidden: names(raw.hidden), solo: names(raw.solo) };
  } catch {
    return NO_REF_FILTER;
  }
}

export function saveGraphFilter(
  root: string,
  filter: GraphRefFilter,
  storage: (KeyValueStorage & { removeItem?(key: string): void }) | null = browserStorage(),
): void {
  try {
    if (refFilterActive(filter)) storage?.setItem(PREFIX + root, JSON.stringify(filter));
    else storage?.removeItem?.(PREFIX + root);
  } catch {
    // Bị chặn / hết chỗ: bộ lọc chỉ sống trong phiên này.
  }
}
