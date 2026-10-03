// Menu nổi dùng chung (menu thả xuống của nút thanh công cụ và menu chuột phải): một menu tại một thời điểm, vẽ bằng
// MenuHost. Mục menu là dữ liệu thuần (tiêu đề + hàm chạy) — tiêu đề có thể chứa tên nhánh do repo đặt, luôn vẽ dạng chữ.

import type { IconName } from '../ui/icons.ts';

export type MenuItem =
  | {
      readonly kind?: 'item';
      readonly title: string;
      readonly run: () => void;
      readonly icon?: IconName;
      readonly disabled?: boolean;
      readonly destructive?: boolean;
      /** Phím tắt chỉ để hiển thị ("Ctrl+Shift+L"). */
      readonly shortcut?: string;
      /** Dấu ✓ (mục đang chọn). */
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

/** Mục chạy được (không phải vách ngăn / tiêu đề / menu con). */
export type MenuAction = Extract<MenuItem, { run: () => void }>;

export function isMenuAction(item: MenuItem): item is MenuAction {
  return item.kind === undefined || item.kind === 'item';
}

export interface OpenMenu {
  readonly id: number;
  readonly items: readonly MenuItem[];
  readonly x: number;
  readonly y: number;
  /** Rộng tối thiểu (menu thả xuống rộng bằng nút). */
  readonly minWidth: number;
  /** Phần tử mở menu: trả tiêu điểm về đó khi đóng. */
  readonly opener: HTMLElement | null;
  /** Mở bằng bàn phím: chọn sẵn mục đầu tiên. */
  readonly focusFirst: boolean;
}

/** Bỏ vách ngăn thừa (đầu, cuối, hai vách liền nhau) sau khi lọc mục theo điều kiện. */
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

  /** Menu thả xuống dưới `element` (căn trái theo nút). */
  openBelow(element: HTMLElement, items: readonly MenuItem[], options: { focusFirst?: boolean } = {}): void {
    const rect = element.getBoundingClientRect();
    this.show(items, rect.left, rect.bottom + 4, rect.width, element, options.focusFirst ?? false);
  }

  /** Menu chuột phải tại vị trí con trỏ. */
  openAt(event: MouseEvent, items: readonly MenuItem[]): void {
    event.preventDefault();
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.show(items, event.clientX, event.clientY, 0, opener, false);
  }

  /** Menu tại một điểm trên màn hình (vd. chỗ vừa thả khi kéo-thả). */
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

  /** Chạy một mục: đóng menu trước (mục có thể mở hộp thoại). */
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
