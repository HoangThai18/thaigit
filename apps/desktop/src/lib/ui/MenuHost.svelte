<!--
  Vẽ menu đang mở (`menus.current`) bằng MenuPanel (có menu con); đóng khi bấm ra ngoài / Esc / cửa sổ mất tiêu điểm / đổi
  kích thước. Phím bấm trong menu không lan ra cửa sổ (Esc không đóng luôn khung diff phía sau).
-->
<script lang="ts">
  import { menus, type MenuStore } from '../stores/menus.svelte.ts';
  import MenuPanel from './MenuPanel.svelte';

  interface Props {
    store?: MenuStore;
  }

  let { store = menus }: Props = $props();

  const menu = $derived(store.current);
  let root = $state<HTMLDivElement | null>(null);

  function onwindowpointerdown(event: PointerEvent): void {
    if (!menu) return;
    if (event.target instanceof Node && root?.contains(event.target)) return;
    // Bấm lại đúng nút đã mở menu: chỉ đóng (không để nút mở lại ngay).
    if (event.target instanceof Node && menu.opener?.contains(event.target)) {
      event.stopPropagation();
      event.preventDefault();
    }
    store.close(false);
  }
</script>

<svelte:window
  onpointerdowncapture={onwindowpointerdown}
  onblur={() => store.close(false)}
  onresize={() => store.close(false)}
/>

{#if menu}
  {#key menu.id}
    <div class="host" bind:this={root} role="presentation" onkeydown={(event) => event.stopPropagation()}>
      <MenuPanel
        items={menu.items}
        anchor={{ x: menu.x, y: menu.y }}
        minWidth={menu.minWidth}
        focusFirst={menu.focusFirst}
        flipUp={menu.minWidth === 0}
        run={(item) => store.run(item)}
        closeAll={() => store.close()}
      />
    </div>
  {/key}
{/if}

<style>
  .host {
    display: contents;
  }
</style>
