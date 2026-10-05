// Shared popup menus (a toolbar button's dropdown and the context menu): one menu at a time, drawn by MenuHost. Items are
// plain data (a title plus a function to run) — a title may contain a repo-chosen branch name, so it is always drawn as text.

import type { IconName } from '../ui/icons.ts';

export type MenuItem =
  | {
      readonly kind?: 'item';
      readonly title: string;
      readonly run: () => void;
      readonly icon?: IconName;
      readonly disabled?: boolean;
      readonly destructive?: boolean;
      /** A display-only shortcut ("Ctrl+Shift+L"). */
      readonly shortcut?: string;
      /** A ✓ mark (the item is currently selected). */
      readonly checked?: boolean;
    }
  | {
      readonly kind: 'submenu';
      readonly title: string;
      readonly items: readonly MenuItem[];
      readonly icon?: IconName;
      readonly disabled?: boolean;
    }
  | { readonly kind: 'separator' }
  | { readonly kind: 'header'; readonly title: string };

/** A runnable item (not a separator / heading / submenu). */
export type MenuAction = Extract<MenuItem, { run: () => void }>;

export function isMenuAction(item: MenuItem): item is MenuAction {
  return item.kind === undefined || item.kind === 'item';
}

export interface OpenMenu {
  readonly id: number;
  readonly items: readonly MenuItem[];
  readonly x: number;
  readonly y: number;
  /** Minimum width (the dropdown is as wide as the button). */
  readonly minWidth: number;
  /** The element that opened the menu: focus returns there on close. */
  readonly opener: HTMLElement | null;
  /** Open via keyboard: preselect the first item. */
  readonly focusFirst: boolean;
}

/** Drop redundant separators (at the start, at the end, two in a row) after filtering items by a predicate. */
export function tidyMenu(items: readonly (MenuItem | null | false | undefined)[]): MenuItem[] {
  const result: MenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.kind === 'separator' && (result.length === 0 || result.at(-1)?.kind === 'separator')) continue;
    result.push(item);
  }
  while (result.at(-1)?.kind === 'separator') result.pop();
  return result;
}

export class MenuStore {
  current = $state.raw<OpenMenu | null>(null);
  private serial = 0;

  /** The dropdown under `element` (left-aligned with the button). */
  openBelow(element: HTMLElement, items: readonly MenuItem[], options: { focusFirst?: boolean } = {}): void {
    const rect = element.getBoundingClientRect();
    this.show(items, rect.left, rect.bottom + 4, rect.width, element, options.focusFirst ?? false);
  }

  /** The context menu at the pointer position. */
  openAt(event: MouseEvent, items: readonly MenuItem[]): void {
    event.preventDefault();
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.show(items, event.clientX, event.clientY, 0, opener, false);
  }

  /** A menu at a point on screen (e.g. where an item was just dropped after a drag). */
  openAtPoint(x: number, y: number, items: readonly MenuItem[]): void {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.show(items, x, y, 0, opener, false);
  }

  close(restoreFocus = true): void {
    const menu = this.current;
    if (!menu) return;
    this.current = null;
    if (restoreFocus && menu.opener?.isConnected) menu.opener.focus({ preventScroll: true });
  }

  /** Run one item: close the menu first (an item may open a dialog). */
  run(item: MenuItem): void {
    if (!isMenuAction(item) || item.disabled) return;
    this.close();
    item.run();
  }

  private show(
    items: readonly MenuItem[],
    x: number,
    y: number,
    minWidth: number,
    opener: HTMLElement | null,
    focusFirst: boolean,
  ): void {
    if (items.length === 0) return;
    this.current = { id: ++this.serial, items, x, y, minWidth, opener, focusFirst };
  }
}

export const menus = new MenuStore();
