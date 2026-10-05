<!--
  MỘT canvas phủ cột Graph, vẽ làn/đường cong/node bằng `paintGraph` ở độ phân giải `devicePixelRatio`.
  Canvas nằm TRONG nội dung cuộn (cuộn cùng các hàng chữ nên không lệch khi cuộn nhanh) và chỉ vẽ một cửa sổ hàng quanh vùng
  đang thấy (cỡ ≤ 3 khung nhìn, tối đa 8192 px theo giới hạn canvas của WebKit), vẽ lại khi cuộn tới gần mép cửa sổ,
  khi dữ liệu/màu/DPR/độ rộng đổi — không bao giờ vẽ cả 30.000 hàng.
-->
<script lang="ts">
  import { isWorkingTreeCommit } from '@thaigit/core';
  import { paintGraph, type PaintRow, type PaintTheme } from './GraphCanvas.ts';
  import { GraphStyle, initials, readLaneColors } from './style.ts';
  import type { GraphEntry } from '../stores/repo.svelte.ts';
  import { untrack } from 'svelte';
  import type { AvatarStore } from './avatars.svelte.ts';

  interface Props {
    entries: readonly GraphEntry[];
    /** Store `graphVersion`: changes whenever graph data changes, even when `entries` keeps the same length. */
    version: number;
    headOid: string | null;
    /** Graph column width (CSS px). */
    width: number;
    /** Distance from the row's left edge to the Graph column (px). */
    left: number;
    /** First visible row and the row after the last visible one. */
    start: number;
    end: number;
    /** Changes when the colour scheme flips (light/dark). */
    themeVersion: number;
    /** Downloaded author avatars; its `version` is part of the repaint condition too. */
    avatars: AvatarStore;
    /** Email of the current committer: the WIP row node draws that person's avatar. */
    wipEmail: string | null;
  }

  let { entries, version, headOid, width, left, start, end, themeVersion, avatars, wipEmail }: Props =
    $props();

  const ROW = GraphStyle.rowHeight;
  /** Canvas edge limit (device px) to stay safe on WebKit. */
  const MAX_CANVAS_PX = 8192;
  const MIN_PAD_ROWS = 24;

  let canvas = $state<HTMLCanvasElement>();
  let dpr = $state(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  let windowFirst = $state(0);
  let windowLast = $state(0);

  /**
   * Track DPR changes (dragging the window to another screen, zoom, Windows 125%/150% display scaling).
   * `matchMedia` fires only ONCE per value, so the listener has to be re-armed after every fire; the extra
   * `resize` listener is a safety net because some WebViews skip the media query event on DPR changes.
   */
  $effect(() => {
    let query: MediaQueryList | undefined;
    let disposed = false;
    const sync = (): void => {
      const next = window.devicePixelRatio || 1;
      if (next !== untrack(() => dpr)) dpr = next;
    };
    const fire = (): void => {
      if (disposed) return;
      sync();
      arm();
    };
    const arm = (): void => {
      query?.removeEventListener('change', fire);
      query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener('change', fire, { once: true });
    };
    arm();
    window.addEventListener('resize', sync);
    return () => {
      disposed = true;
      query?.removeEventListener('change', fire);
      window.removeEventListener('resize', sync);
    };
  });

  /** Painting window: it only moves once the visible range nears an edge (or data/DPR changes), so scrolling does not repaint every frame. */
  $effect(() => {
    const total = entries.length;
    void version;
    const visibleRows = Math.max(1, end - start);
    const maxRows = Math.max(visibleRows, Math.floor(MAX_CANVAS_PX / (ROW * dpr)));
    const pad = Math.max(
      0,
      Math.min(Math.max(MIN_PAD_ROWS, visibleRows), Math.floor((maxRows - visibleRows) / 2)),
    );
    const margin = Math.min(3, Math.floor(pad / 2));
    const first = untrack(() => windowFirst);
    const last = untrack(() => windowLast);
    const topOk = first === 0 || start >= first + margin;
    const bottomOk = last >= total || end <= last - margin;
    const empty = last <= first;
    const stale = last > total;
    if (empty || stale || !topOk || !bottomOk) {
      const nextFirst = Math.max(0, start - pad);
      const nextLast = Math.min(total, end + pad);
      if (nextFirst !== first) windowFirst = nextFirst;
      if (nextLast !== last) windowLast = nextLast;
    }
  });

  function readTheme(element: HTMLElement): PaintTheme {
    const style = getComputedStyle(element);
    return {
      laneColors: readLaneColors(element),
      workingTreeColor: style.getPropertyValue('--text-secondary').trim() || '#8a93a3',
      background: style.getPropertyValue('--bg-2').trim() || '#e9eff6',
      initialsColor: '#ffffff',
      avatar: (email) => avatars.image(email),
    };
  }

  function toPaintRow(entry: GraphEntry | undefined): PaintRow | undefined {
    if (!entry) return undefined;
    const { commit, row, labels } = entry;
    const wip = isWorkingTreeCommit(commit);
    return {
      lane: row.lane,
      color: row.color,
      lines: row.lines,
      isWorkingTree: wip,
      isMerge: commit.parents.length > 1,
      isHead: commit.id === headOid,
      hasLabels: labels.length > 0,
      dimmed: false,
      initials: initials(commit.authorName),
      authorEmail: wip ? (wipEmail ?? '') : commit.authorEmail,
    };
  }

  /** Paint the current row window. Runs after the DOM (canvas top/height) has been updated and before the browser paints a frame. */
  $effect(() => {
    const element = canvas;
    if (!element) return;
    void version;
    void themeVersion;
    // An avatar finished loading mid-window: the store's `version` bumps, so the canvas must repaint right
    // away — otherwise that dot only shows its avatar after a scroll or a data refresh.
    void avatars.version;
    const first = windowFirst;
    const last = Math.min(windowLast, entries.length);
    const ratio = dpr;
    const cssWidth = width;
    const rows = Math.max(0, last - first);
    const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(rows * ROW * ratio));
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, rows * ROW);
    if (rows === 0) return;
    paintGraph(context, (index) => toPaintRow(entries[index]), first, last, 0, readTheme(element));
  });
</script>

<canvas
  bind:this={canvas}
  class="graph-canvas"
  aria-hidden="true"
  style:left="{left}px"
  style:top="{windowFirst * ROW}px"
  style:width="{width}px"
  style:height="{Math.max(0, windowLast - windowFirst) * ROW}px"
></canvas>

<style>
  .graph-canvas {
    position: absolute;
    pointer-events: none;
    /* Transparent: the row background (selected/hovered) has to show through. */
    background: transparent;
  }
</style>
