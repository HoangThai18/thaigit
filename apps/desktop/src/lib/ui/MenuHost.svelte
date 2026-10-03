<!--
  Vẽ menu đang mở (`menus.current`): đặt ở vị trí yêu cầu, tự dời vào trong cửa sổ, đóng khi bấm ra ngoài / Esc / cửa sổ
  mất tiêu điểm / đổi kích thước. Phím ↑ ↓ Home End để di chuyển, Enter / Space để chọn.
-->
<script lang="ts">
  import { menus, type MenuItem, type MenuStore } from '../stores/menus.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    store?: MenuStore;
  }

  let { store = menus }: Props = $props();

  const menu = $derived(store.current);
  let element = $state<HTMLDivElement | null>(null);
  let position = $state({ left: 0, top: 0 });

  const MARGIN = 6;

  // Mỗi menu mới: đo rồi dời vào trong cửa sổ, chọn sẵn mục đầu nếu mở bằng bàn phím.
  $effect(() => {
    const current = menu;
    const node = element;
    if (!current || !node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = current.x;
    let top = current.y;
    if (left + width > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - MARGIN - width);
    if (top + height > window.innerHeight - MARGIN) {
      // Menu chuột phải: lật lên trên con trỏ; menu thả xuống: dời lên cho vừa.
      top = current.minWidth === 0 && current.y - height >= MARGIN ? current.y - height : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    position = { left, top };
    if (current.focusFirst) focusable(node)[0]?.focus();
    else node.focus({ preventScroll: true });
  });

  function focusable(node: HTMLElement): HTMLButtonElement[] {
    return [...node.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
  }

  function move(delta: number | 'first' | 'last'): void {
    if (!element) return;
    const items = focusable(element);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = items.length - 1;
    else if (index < 0) next = delta > 0 ? 0 : items.length - 1;
    else next = (index + delta + items.length) % items.length;
    items[next]?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        store.close();
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
      case 'Tab':
        event.preventDefault();
        store.close();
        break;
    }
  }

  function onwindowpointerdown(event: PointerEvent): void {
    if (!menu || !element) return;
    if (event.target instanceof Node && element.contains(event.target)) return;
    // Bấm lại đúng nút đã mở menu: chỉ đóng (không để nút mở lại ngay).
    if (event.target instanceof Node && menu.opener?.contains(event.target)) {
      event.stopPropagation();
      event.preventDefault();
    }
    store.close(false);
  }

  function isItem(item: MenuItem): item is Extract<MenuItem, { title: string; run: () => void }> {
    return item.kind === undefined || item.kind === 'item';
  }
</script>

<svelte:window
  onpointerdowncapture={onwindowpointerdown}
  onblur={() => store.close(false)}
  onresize={() => store.close(false)}
/>

{#if menu}
  {#key menu.id}
    <div
      class="menu glass"
      role="menu"
      tabindex="-1"
      bind:this={element}
      style:left="{position.left}px"
      style:top="{position.top}px"
      style:min-width="{Math.max(menu.minWidth, 180)}px"
      {onkeydown}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#each menu.items as item, index (index)}
        {#if item.kind === 'separator'}
          <div class="separator" role="separator"></div>
        {:else if item.kind === 'header'}
          <div class="header"><bdi>{item.title}</bdi></div>
        {:else if isItem(item)}
          <button
            type="button"
            role="menuitem"
            class="item"
            class:destructive={item.destructive}
            disabled={item.disabled}
            onclick={() => store.run(item)}
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
  {/key}
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
  .item:focus-visible {
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
