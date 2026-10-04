<!--
  Thanh tab của cửa sổ (chỉ hiện khi có từ hai tab): bấm để chuyển repo, nút × hoặc nhấp chuột giữa để đóng, kéo để đổi chỗ,
  chuột phải để đóng tab khác / chép đường dẫn, nút + để mở tab mới. Phím ← / → chuyển tab khi tab đang có focus.
-->
<script lang="ts">
  import { showBidi } from '../format/bidi.ts';
  import { menus, type MenuItem } from '../stores/menus.svelte.ts';
  import type { TabItem } from '../stores/tabs.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    items: readonly TabItem[];
    activeId: number | null;
    onactivate: (id: number) => void;
    onclose: (id: number) => void;
    onnew: () => void;
    onmove: (id: number, index: number) => void;
    menu: (id: number) => MenuItem[];
  }

  let { items, activeId, onactivate, onclose, onnew, onmove, menu }: Props = $props();

  let bar = $state<HTMLElement | undefined>();
  /** Tab đang kéo (đổi chỗ) — chỉ coi là kéo khi chuột đã đi quá vài px. */
  let dragging: { id: number; x: number; moved: boolean } | null = null;

  function focusTab(index: number): void {
    const tab = items[index];
    if (!tab) return;
    onactivate(tab.id);
    bar?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  }

  function onkeydown(event: KeyboardEvent, index: number, id: number): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      focusTab((index + delta + items.length) % items.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onactivate(id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onclose(id);
    }
  }

  function onpointerdown(event: PointerEvent, id: number): void {
    if (event.button !== 0) return;
    dragging = { id, x: event.clientX, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onpointermove(event: PointerEvent): void {
    if (!dragging || !bar) return;
    if (!dragging.moved && Math.abs(event.clientX - dragging.x) < 6) return;
    dragging.moved = true;
    const tabs = [...bar.querySelectorAll<HTMLElement>('[role="tab"]')];
    const target = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX < rect.right;
    });
    if (target >= 0 && items[target]?.id !== dragging.id) onmove(dragging.id, target);
  }

  function onpointerup(): void {
    dragging = null;
  }
</script>

<div class="tabbar" role="tablist" aria-label={vi.tabs.label} bind:this={bar} data-tauri-drag-region>
  <span class="inset" data-tauri-drag-region></span>
  <!-- Khoá theo id: id tab do app cấp nên luôn duy nhất (không phải dữ liệu lấy từ repo). -->
  {#each items as item, index (item.id)}
    {@const active = item.id === activeId}
    <div
      class="tab"
      class:active
      role="tab"
      tabindex={active ? 0 : -1}
      aria-selected={active}
      title={showBidi(item.tooltip)}
      onclick={() => onactivate(item.id)}
      onauxclick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onclose(item.id);
        }
      }}
      onkeydown={(event) => onkeydown(event, index, item.id)}
      oncontextmenu={(event) => menus.openAt(event, menu(item.id))}
      onpointerdown={(event) => onpointerdown(event, item.id)}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
    >
      <span class="title"><bdi>{showBidi(item.title)}</bdi></span>
      <button
        type="button"
        class="close"
        tabindex="-1"
        title={vi.tabs.closeTab}
        aria-label={vi.tabs.closeNamed(item.title)}
        onpointerdown={(event) => event.stopPropagation()}
        onclick={(event) => {
          event.stopPropagation();
          onclose(item.id);
        }}
      >
        <Icon name="x" size={11} strokeWidth={2.4} />
      </button>
    </div>
  {/each}
  <button type="button" class="new" title={vi.tabs.newTab} aria-label={vi.tabs.newTab} onclick={onnew}>
    <Icon name="plus" size={13} strokeWidth={2.4} />
  </button>
  <span class="grow" data-tauri-drag-region></span>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: flex-end;
    flex: none;
    gap: 2px;
    height: 34px;
    padding: 0 8px;
    background: var(--sidebar-fill);
    border-bottom: 1px solid var(--separator);
    overflow: hidden;
  }

  .inset {
    flex: none;
    width: var(--titlebar-inset);
    align-self: stretch;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 1 200px;
    min-width: 72px;
    height: 28px;
    padding: 0 4px 0 12px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: var(--radius-s) var(--radius-s) 0 0;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: default;
    user-select: none;
  }

  .tab:hover {
    background: var(--row-hover);
  }

  .tab.active {
    background: var(--toolbar-fill);
    border-color: var(--separator);
    color: var(--text);
    font-weight: 600;
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close,
  .new {
    display: grid;
    place-items: center;
    flex: none;
    border: none;
    background: none;
    color: inherit;
    border-radius: 4px;
  }

  .close {
    width: 18px;
    height: 18px;
    opacity: 0;
  }

  .tab:hover .close,
  .tab.active .close {
    opacity: 0.75;
  }

  .close:hover {
    opacity: 1;
    background: var(--chip-fill);
  }

  .new {
    width: 26px;
    height: 26px;
    margin-bottom: 1px;
    color: var(--text-secondary);
  }

  .new:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .grow {
    flex: 1;
    align-self: stretch;
  }
</style>
