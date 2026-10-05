// Hand-rolled drag and drop on pointer events (no HTML5 DnD: WebView2 on Windows often swallows the
// events, and it has to behave identically on both OSes). A source calls `drag.begin(event, payload)` in
// `onpointerdown`; a target only needs a `data-drop` attribute ("ref:<full name>", "remote:<name>",
// "zone:staged" | "zone:unstaged"). Moving more than 5 px starts the drag — clicks and double-clicks
// still work as before; the click that follows a drop is suppressed so a row isn't selected by accident.

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
  /** Whether the current target accepts this payload. */
  readonly accepted: boolean;
}

export interface DropHandler {
  canDrop(payload: DragPayload, target: DropTarget): boolean;
  drop(payload: DragPayload, target: DropTarget, point: { x: number; y: number }): void;
}

const THRESHOLD = 5;

/** `data-drop` value for a ref / remote (URI-encoded: repo-supplied names may contain control characters). */
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
   * Start tracking a press on the drag source. `payload` is only called once a real drag begins (past the
   * threshold); `null` = dragging is not allowed.
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
      // The click right after a drop must not select a row / open a file.
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

  /** Cancel the in-flight drag (e.g. closing the repo). */
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
