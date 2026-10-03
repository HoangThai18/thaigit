<!--
  Một tầng menu (gốc hoặc menu con). Tự dời vào trong cửa sổ; menu con mở sang phải mục cha (hết chỗ thì sang trái).
  Phím: ↑ ↓ Home End di chuyển, → / Enter mở menu con, ← quay về tầng cha, Esc đóng cả menu.
-->
<script lang="ts">
  import { isMenuAction, type MenuItem } from '../stores/menus.svelte.ts';
  import Icon from './Icon.svelte';
  import MenuPanel from './MenuPanel.svelte';

  interface Props {
    items: readonly MenuItem[];
    /** Góc trên-trái mong muốn (menu gốc) hoặc hình chữ nhật của mục cha (menu con). */
    anchor: { x: number; y: number } | DOMRect;
    minWidth: number;
    /** Chọn sẵn mục đầu (mở bằng bàn phím / mở menu con bằng phím). */
    focusFirst: boolean;
    /** Menu chuột phải: hết chỗ phía dưới thì lật lên trên con trỏ. */
    flipUp?: boolean;
    run: (item: MenuItem) => void;
    closeAll: () => void;
    /** Menu con: ← quay về mục cha. */
    onback?: () => void;
  }

  let { items, anchor, minWidth, focusFirst, flipUp = false, run, closeAll, onback }: Props = $props();

  const MARGIN = 6;
  let element = $state<HTMLDivElement | null>(null);
  let position = $state({ left: -9999, top: -9999 });
  let openIndex = $state<number | null>(null);
  let childAnchor = $state<DOMRect | null>(null);
  let childFocusFirst = $state(false);

  // Đo rồi đặt vị trí (chạy lại khi mục / neo đổi).
  $effect(() => {
    const node = element;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left: number;
    let top: number;
    if (anchor instanceof DOMRect) {
      left = anchor.right - 2;
      if (left + width > window.innerWidth - MARGIN) left = Math.max(MARGIN, anchor.left - width + 2);
      top = anchor.top - 5;
    } else {
      left = anchor.x;
      top = anchor.y;
      if (left + width > window.innerWidth - MARGIN)
        left = Math.max(MARGIN, window.innerWidth - MARGIN - width);
    }
    if (top + height > window.innerHeight - MARGIN) {
      top =
        flipUp && !(anchor instanceof DOMRect) && anchor.y - height >= MARGIN
          ? anchor.y - height
          : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    position = { left, top };
  });

  $effect(() => {
    const node = element;
    if (!node) return;
    if (focusFirst) buttons(node)[0]?.focus({ preventScroll: true });
    else node.focus({ preventScroll: true });
  });

  function buttons(node: HTMLElement): HTMLButtonElement[] {
    return [...node.querySelectorAll<HTMLButtonElement>(':scope > button[role="menuitem"]:not(:disabled)')];
  }

  function move(delta: number | 'first' | 'last'): void {
    if (!element) return;
    const list = buttons(element);
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = list.length - 1;
    else if (index < 0) next = delta > 0 ? 0 : list.length - 1;
    else next = (index + delta + list.length) % list.length;
    list[next]?.focus();
  }

  function openSubmenu(index: number, button: HTMLElement, byKeyboard: boolean): void {
    childAnchor = button.getBoundingClientRect();
    childFocusFirst = byKeyboard;
    openIndex = index;
  }

  function closeSubmenu(refocus: boolean): void {
    const index = openIndex;
    openIndex = null;
    if (refocus && index !== null && element) {
      element.querySelector<HTMLButtonElement>(`:scope > button[data-index="${index}"]`)?.focus();
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const index = target?.dataset['index'] !== undefined ? Number(target.dataset['index']) : null;
    const item = index !== null ? items[index] : undefined;
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        closeAll();
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        move('first');
        break;
      case 'End':
        event.preventDefault();
        move('last');
        break;
      case 'ArrowRight':
        if (item?.kind === 'submenu' && target && index !== null) {
          event.preventDefault();
          openSubmenu(index, target, true);
        }
        break;
      case 'ArrowLeft':
        if (onback) {
          event.preventDefault();
          onback();
        }
        break;
    }
  }
</script>

<div
  class="menu"
  role="menu"
  tabindex="-1"
  bind:this={element}
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:min-width="{Math.max(minWidth, 180)}px"
  {onkeydown}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#each items as item, index (index)}
    {#if item.kind === 'separator'}
      <div class="separator" role="separator"></div>
    {:else if item.kind === 'header'}
      <div class="header"><bdi>{item.title}</bdi></div>
    {:else if item.kind === 'submenu'}
      <button
        type="button"
        role="menuitem"
        class="item"
        class:open={openIndex === index}
        aria-haspopup="menu"
        aria-expanded={openIndex === index}
        data-index={index}
        disabled={item.disabled || item.items.length === 0}
        onclick={(event) => openSubmenu(index, event.currentTarget, event.detail === 0)}
        onpointerenter={(event) => openSubmenu(index, event.currentTarget, false)}
      >
        <span class="icon"
          >{#if item.icon}<Icon name={item.icon} size={14} />{/if}</span
        >
        <span class="title"><bdi>{item.title}</bdi></span>
        <span class="chevron"><Icon name="chevron-right" size={12} /></span>
      </button>
    {:else if isMenuAction(item)}
      <button
        type="button"
        role="menuitem"
        class="item"
        class:destructive={item.destructive}
        data-index={index}
        disabled={item.disabled}
        onclick={() => run(item)}
        onpointerenter={() => closeSubmenu(false)}
      >
        <span class="icon">
          {#if item.checked}
            <Icon name="check" size={14} />
          {:else if item.icon}
            <Icon name={item.icon} size={14} />
          {/if}
        </span>
        <span class="title"><bdi>{item.title}</bdi></span>
        {#if item.shortcut}
          <span class="shortcut">{item.shortcut}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>
<!-- Menu con là anh em (không lồng trong .menu): .menu cuộn được nên lồng vào sẽ bị cắt. -->
{#if openIndex !== null && childAnchor}
  {@const child = items[openIndex]}
  {#if child?.kind === 'submenu'}
    {#key openIndex}
      <MenuPanel
        items={child.items}
        anchor={childAnchor}
        minWidth={0}
        focusFirst={childFocusFirst}
        {run}
        {closeAll}
        onback={() => closeSubmenu(true)}
      />
    {/key}
  {/if}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 800;
    display: flex;
    flex-direction: column;
    max-width: min(420px, calc(100vw - 12px));
    max-height: calc(100vh - 12px);
    overflow-y: auto;
    padding: 5px;
    border: 1px solid var(--glass-rim);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
    font-size: 13px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px 5px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: default;
  }

  .item:hover:not(:disabled),
  .item:focus-visible,
  .item.open {
    background: var(--accent);
    color: #fff;
    outline: none;
  }

  .item:disabled {
    color: var(--text-tertiary);
  }

  .item.destructive:not(:hover):not(:focus-visible) {
    color: var(--danger);
  }

  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 16px;
  }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut {
    flex: none;
    margin-left: 18px;
    opacity: 0.6;
    font-size: 12px;
  }

  .chevron {
    display: grid;
    flex: none;
    margin-left: 12px;
    opacity: 0.7;
  }

  .separator {
    height: 1px;
    margin: 4px 6px;
    background: var(--separator);
  }

  .header {
    padding: 6px 10px 3px 30px;
    color: var(--text-tertiary);
    font-size: 11.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
