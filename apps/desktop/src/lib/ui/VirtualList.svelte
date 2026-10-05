<!--
  Danh sách ảo hoá, hàng cao cố định: chỉ dựng các hàng đang thấy (+ vùng đệm) — 30.000 commit vẫn mượt.
  Hàng đặt bằng transform nên cuộn không làm dựng lại cả danh sách.
  `overlay` (tuỳ chọn) vẽ MỘT lớp nằm trong nội dung cuộn, phủ lên các hàng (vd. canvas graph): lớp này cuộn cùng nội dung
  nên không bị lệch so với hàng khi cuộn nhanh (compositor cuộn trước khi JS kịp chạy).
-->
<script lang="ts" module>
  export interface VisibleRange {
    /** First visible row (excluding the buffer zone). */
    start: number;
    /** The row after the last visible one. */
    end: number;
    /** Viewport height (px). */
    height: number;
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  interface Props {
    items: readonly T[];
    rowHeight: number;
    /** Rows rendered beyond the visible range on each side. */
    overscan?: number;
    /** Stable key per row (default: the index). */
    key?: (item: T, index: number) => string | number;
    row: Snippet<[T, number]>;
    overlay?: Snippet<[VisibleRange]>;
    /** Report the visible range (to load more when nearing the end). */
    onrange?: (range: VisibleRange & { scrollTop: number }) => void;
    label?: string;
    /** Horizontal extent of the content (excluding the scrollbar) — used to align the column header with the rows. */
    contentWidth?: number;
    /** Minimum horizontal width of the content (CSS, e.g. "calc(120ch + 80px)"): when set, horizontal scrolling is possible (long diff lines). */
    minContentWidth?: string;
  }

  let {
    items,
    rowHeight,
    overscan = 10,
    key,
    row,
    overlay,
    onrange,
    label,
    contentWidth = $bindable(0),
    minContentWidth,
  }: Props = $props();

  let viewport = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(0);

  const start = $derived(Math.floor(scrollTop / rowHeight));
  const end = $derived(Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight)));
  const first = $derived(Math.max(0, start - overscan));
  const last = $derived(Math.min(items.length, end + overscan));
  const visible = $derived(items.slice(first, last));

  $effect(() => {
    onrange?.({ start, end, scrollTop, height });
  });

  /**
   * Scroll so row `index` becomes visible; `center` puts the row in the middle (like picking a branch in the
   * sidebar → jump to its commit), `top` puts it at the top of the viewport (jumping to a diff hunk).
   */
  export function scrollToIndex(index: number, mode: 'nearest' | 'center' | 'top' = 'nearest'): void {
    if (!viewport || index < 0 || index >= items.length) return;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (
      mode === 'nearest' &&
      top >= viewport.scrollTop &&
      bottom <= viewport.scrollTop + viewport.clientHeight
    )
      return;
    viewport.scrollTop =
      mode === 'top'
        ? top
        : mode === 'center'
          ? Math.max(0, top - (viewport.clientHeight - rowHeight) / 2)
          : top < viewport.scrollTop
            ? top
            : bottom - viewport.clientHeight;
  }

  /** Number of whole rows that fit in the viewport (for PageUp/PageDown). */
  export function pageSize(): number {
    return Math.max(1, Math.floor((viewport?.clientHeight ?? 0) / rowHeight) - 1);
  }
</script>

<div
  class="viewport"
  class:scroll-x={minContentWidth !== undefined}
  bind:this={viewport}
  bind:clientHeight={height}
  bind:clientWidth={contentWidth}
  onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
  aria-label={label}
>
  <div class="spacer" style:height="{items.length * rowHeight}px" style:min-width={minContentWidth}>
    {#each visible as item, offset (key ? key(item, first + offset) : first + offset)}
      <div
        class="row"
        style:height="{rowHeight}px"
        style:transform="translateY({(first + offset) * rowHeight}px)"
      >
        {@render row(item, first + offset)}
      </div>
    {/each}
    {#if overlay}
      {@render overlay({ start, end, height })}
    {/if}
  </div>
</div>

<style>
  .viewport {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }

  .viewport.scroll-x {
    overflow-x: auto;
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  .row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    contain: layout paint;
  }
</style>
