// Kéo-thả tự viết bằng pointer events (không dùng HTML5 DnD: WebView2 trên Windows hay nuốt sự kiện, và cần chạy giống
// nhau trên 2 OS). Nguồn gọi `drag.begin(event, payload)` trong `onpointerdown`; đích chỉ cần thuộc tính `data-drop`
// ("ref:<tên đầy đủ>", "remote:<tên>", "zone:staged" | "zone:unstaged"). Kéo quá 5 px mới tính là kéo — bấm / nhấp đúp
// vẫn như cũ; sau khi thả, cú click đi kèm bị chặn để không chọn nhầm hàng.

import type { FileChange, GitRef } from '@thaigit/core';

export type DragPayload =
  | { readonly kind: 'ref'; readonly ref: GitRef; readonly label: string }
  | {
      readonly kind: 'files';
      readonly from: 'unstaged' | 'staged';
      readonly changes: readonly FileChange[];
      readonly label: string;
    };

export type DropTarget =
  | { readonly kind: 'ref'; readonly fullName: string }
  | { readonly kind: 'remote'; readonly name: string }
  | { readonly kind: 'zone'; readonly zone: 'staged' | 'unstaged' };

export interface ActiveDrag {
  readonly payload: DragPayload;
  readonly x: number;
  readonly y: number;
  readonly target: DropTarget | null;
  /** Đích hiện tại nhận được payload này không. */
  readonly accepted: boolean;
}

export interface DropHandler {
  canDrop(payload: DragPayload, target: DropTarget): boolean;
  drop(payload: DragPayload, target: DropTarget, point: { x: number; y: number }): void;
}

const THRESHOLD = 5;

/** Giá trị `data-drop` cho một ref / remote (mã hoá URI: tên do repo đặt có thể chứa ký tự điều khiển). */
export function dropAttr(kind: 'ref' | 'remote', name: string): string {
  return `${kind}:${encodeURIComponent(name)}`;
}

export function parseDropTarget(value: string | undefined | null): DropTarget | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon === -1) return null;
  const kind = value.slice(0, colon);
  let rest: string;
  try {
    rest = decodeURIComponent(value.slice(colon + 1));
  } catch {
    return null;
  }
  if (rest === '') return null;
  if (kind === 'ref') return { kind: 'ref', fullName: rest };
  if (kind === 'remote') return { kind: 'remote', name: rest };
  if (kind === 'zone' && (rest === 'staged' || rest === 'unstaged')) return { kind: 'zone', zone: rest };
  return null;
}

export class DragStore {
  active = $state.raw<ActiveDrag | null>(null);
  handler: DropHandler | null = null;
  #over: Element | null = null;
  #cleanup: (() => void) | null = null;

  /**
   * Bắt đầu theo dõi một lần nhấn trên nguồn kéo. `payload` chỉ được gọi khi thật sự kéo (quá ngưỡng); trả `null` = không
   * cho kéo.
   */
  begin(event: PointerEvent, payload: () => DragPayload | null): void {
    if (event.button !== 0 || this.#cleanup !== null) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let started: DragPayload | null = null;

    const move = (moveEvent: PointerEvent) => {
      if (started === null) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < THRESHOLD) return;
        started = payload();
        if (started === null) {
          finish();
          return;
        }
        document.documentElement.classList.add('dragging');
      }
      moveEvent.preventDefault();
      this.#update(started, moveEvent.clientX, moveEvent.clientY);
    };
    const up = (upEvent: PointerEvent) => {
      const drag = this.active;
      finish();
      if (started === null || drag === null) return;
      // Cú click ngay sau khi thả không được chọn hàng / mở file.
      const swallow = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (drag.target !== null && drag.accepted) {
        this.handler?.drop(drag.payload, drag.target, { x: upEvent.clientX, y: upEvent.clientY });
      }
    };
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('dragging');
      this.#setOver(null);
      this.active = null;
      this.#cleanup = null;
    };
    const cancel = () => finish();
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    this.#cleanup = finish;
  }

  /** Huỷ lần kéo đang dở (vd. đóng repo). */
  cancel(): void {
    this.#cleanup?.();
  }

  #update(payload: DragPayload, x: number, y: number): void {
    const element = document.elementFromPoint(x, y)?.closest('[data-drop]') ?? null;
    const target = parseDropTarget(element?.getAttribute('data-drop'));
    const accepted = target !== null && (this.handler?.canDrop(payload, target) ?? false);
    this.#setOver(accepted ? element : null);
    this.active = { payload, x, y, target, accepted };
  }

  #setOver(element: Element | null): void {
    if (this.#over === element) return;
    this.#over?.classList.remove('drop-over');
    element?.classList.add('drop-over');
    this.#over = element;
  }
}

export const drag = new DragStore();
