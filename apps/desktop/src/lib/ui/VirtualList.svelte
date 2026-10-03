<!--
  Danh sách ảo hoá, hàng cao cố định: chỉ dựng các hàng đang thấy (+ vùng đệm) — 30.000 commit vẫn mượt.
  Hàng đặt bằng transform nên cuộn không làm dựng lại cả danh sách.
  `overlay` (tuỳ chọn) vẽ MỘT lớp nằm trong nội dung cuộn, phủ lên các hàng (vd. canvas graph): lớp này cuộn cùng nội dung
  nên không bị lệch so với hàng khi cuộn nhanh (compositor cuộn trước khi JS kịp chạy).
-->
<script lang="ts" module>
  export interface VisibleRange {
    /** Hàng đầu tiên thấy được (không tính vùng đệm). */
    start: number;
    /** Hàng sau hàng cuối thấy được. */
    end: number;
    /** Chiều cao khung nhìn (px). */
    height: number;
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  interface Props {
    items: readonly T[];
    rowHeight: number;
    /** Số hàng dựng thêm ở mỗi phía ngoài vùng thấy. */
    overscan?: number;
    /** Khoá ổn định cho mỗi hàng (mặc định: chỉ số). */
    key?: (item: T, index: number) => string | number;
    row: Snippet<[T, number]>;
    overlay?: Snippet<[VisibleRange]>;
    /** Báo vùng đang thấy (để tải thêm khi gần cuối). */
    onrange?: (range: VisibleRange & { scrollTop: number }) => void;
    label?: string;
    /** Bề ngang vùng nội dung (không gồm thanh cuộn) — để căn tiêu đề cột với hàng. */
    contentWidth?: number;
    /** Bề ngang tối thiểu của nội dung (CSS, vd. "calc(120ch + 80px)"): có thì cuộn ngang được (diff dòng dài). */
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
   * Cuộn để hàng `index` hiện ra; `center` đặt hàng ở giữa (như chọn nhánh ở sidebar → nhảy tới commit), `top` đặt hàng lên
   * đầu khung (nhảy tới hunk trong diff).
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

  /** Số hàng đầy đủ nằm gọn trong khung nhìn (cho PageUp/PageDown). */
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
