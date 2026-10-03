<!--
  Bảng commit + graph (port CommitGraphView.swift): hàng DOM ảo hoá cao 30px cho các cột chữ (chữ sắc, chọn/copy được)
  và MỘT canvas phủ cột Graph chỉ vẽ phần thấy. Cột kéo đổi rộng được, tự co/ẩn khi hẹp theo luật Swift; ↑↓ chọn commit;
  tải thêm khi cuộn gần cuối.
-->
<script lang="ts">
  import { drag as dragDrop, dropAttr, parseDropTarget } from '../dnd/drag.svelte.ts';
  import { isMergeCommit, isWorkingTreeCommit, shortSha } from '@thaigit/core';
  import { untrack } from 'svelte';
  import { commitMenu } from '../actions/menus.ts';
  import { showBidi } from '../format/bidi.ts';
  import { formatAbsolute, formatCommitTime } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import type { GraphEntry, RepoStore } from '../stores/repo.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import { theme } from '../theme/theme.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import VirtualList from '../ui/VirtualList.svelte';
  import {
    COLUMN_LIMITS,
    DEFAULT_WIDTHS,
    clampWidth,
    fitColumns,
    graphColumnWidth,
    type ColumnId,
    type SizedColumn,
  } from './columns.ts';
  import { autoLoadMore } from './autoLoadMore.svelte.ts';
  import GraphCanvasLayer from './GraphCanvasLayer.svelte';
  import { measurePillText } from './measure.ts';
  import { layoutPills, pillAppearance, pillIcons, pillTooltip, PILL } from './pills.ts';
  import { GraphStyle, laneColor, readLaneColors } from './style.ts';
  import { workingTreeSummary } from './wip.ts';

  interface Props {
    store: RepoStore;
    /** Double-click / Enter trên một hàng (checkout ở phase sau). */
    onactivate?: (entry: GraphEntry) => void;
  }

  let { store, onactivate }: Props = $props();

  const ROW = GraphStyle.rowHeight;
  const laneColors = readLaneColors(document.documentElement);
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim();

  /** Hàng dựng thêm ngoài vùng thấy ở mỗi phía (truyền cho VirtualList; cũng để biết hàng nào đang có trong DOM). */
  const OVERSCAN = 14;
  // `id` hàng phải duy nhất trong tài liệu (nhiều GraphView có thể cùng tồn tại): lấy tiền tố riêng của component.
  const uid = $props.id();
  const rowId = (index: number): string => `${uid}-row-${index}`;

  let list = $state<VirtualList<GraphEntry>>();
  let graphElement = $state<HTMLDivElement>();
  let rowsWidth = $state(0);
  let rangeStart = $state(0);
  let rangeEnd = $state(0);

  // --- cột ---
  const graphWidthPx = $derived(graphColumnWidth(store.graphLanes));
  const columns = $derived(fitColumns(rowsWidth, prefs.value.columns, graphWidthPx));
  const visible = $derived(new Set<ColumnId>(columns.visible));
  const refsWidth = $derived(columns.widths.refs ?? DEFAULT_WIDTHS.refs);
  const titles = vi.graph.columns;

  const tableStyle = $derived(
    [
      `--w-refs:${refsWidth}px`,
      `--w-graph:${graphWidthPx}px`,
      `--w-author:${columns.widths.author ?? 0}px`,
      `--w-date:${columns.widths.date ?? 0}px`,
      `--w-sha:${columns.widths.sha ?? 0}px`,
    ].join(';'),
  );

  const selectedRow = $derived(store.selectedRow);
  // `aria-activedescendant` chỉ được trỏ vào phần tử có trong DOM: danh sách ảo hoá gỡ hàng ngoài vùng dựng, nên hàng đang chọn
  // mà ở ngoài vùng đó thì bỏ thuộc tính (quay về hộp listbox) thay vì để một id treo.
  const activeDescendant = $derived(
    selectedRow !== null &&
      selectedRow >= Math.max(0, rangeStart - OVERSCAN) &&
      selectedRow < Math.min(store.entries.length, rangeEnd + OVERSCAN)
      ? rowId(selectedRow)
      : undefined,
  );
  const relative = $derived(prefs.value.relativeDates);
  const wipSummary = $derived(workingTreeSummary(store.status));
  const showLoading = $derived(!store.hasLoaded);
  const showError = $derived(store.hasLoaded && store.historyError !== null && store.entries.length === 0);
  const showEmpty = $derived(store.hasLoaded && store.historyError === null && store.entries.length === 0);

  // --- chọn hàng, bàn phím ---
  /** Bấm giữ lên nhãn nhánh / tag rồi kéo: thả lên nhánh khác để merge / rebase, lên remote để push. */
  function beginPillDrag(event: PointerEvent, entry: GraphEntry): void {
    const pill = event.target instanceof Element ? event.target.closest('.pill[data-drop]') : null;
    const target = parseDropTarget(pill?.getAttribute('data-drop'));
    if (target?.kind !== 'ref') return;
    const fullName = target.fullName;
    const label = entry.labels.find((item) => item.refs.some((ref) => ref.fullName === fullName));
    const ref = label?.refs.find((item) => item.fullName === fullName);
    if (!label || !ref) return;
    dragDrop.begin(event, () => ({ kind: 'ref', ref, label: label.text }));
  }

  function selectRow(index: number): void {
    const entry = store.entryAt(index);
    if (!entry) return;
    store.select(
      isWorkingTreeCommit(entry.commit) ? { kind: 'workingTree' } : { kind: 'commit', sha: entry.commit.id },
    );
    list?.scrollToIndex(index, 'nearest');
  }

  function onKeydown(event: KeyboardEvent): void {
    const total = store.entries.length;
    if (total === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = selectedRow ?? -1;
    const page = list?.pageSize() ?? 10;
    let target: number;
    switch (event.key) {
      case 'ArrowDown':
        target = Math.min(total - 1, current + 1);
        break;
      case 'ArrowUp':
        target = current <= 0 ? 0 : current - 1;
        break;
      case 'PageDown':
        target = Math.min(total - 1, Math.max(0, current) + page);
        break;
      case 'PageUp':
        target = Math.max(0, Math.max(0, current) - page);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = total - 1;
        break;
      case 'Enter': {
        const entry = selectedRow === null ? undefined : store.entryAt(selectedRow);
        if (entry) onactivate?.(entry);
        event.preventDefault();
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    selectRow(target);
  }

  // Cuộn tới hàng khi store yêu cầu (chọn nhánh ở sidebar, bấm commit cha, chọn lần đầu). Mỗi yêu cầu chỉ xử lý MỘT lần, và
  // lời gọi `scrollToIndex` nằm trong `untrack`: bên trong nó đọc `items.length` (phản ứng) nên nếu không thì mỗi lần graph
  // nạp lại, effect chạy lại và cuộn về hàng của yêu cầu cũ.
  let handledScrollId = 0;
  $effect(() => {
    const request = store.scrollRequest;
    const target = list;
    if (!request || !target || request.id === handledScrollId) return;
    handledScrollId = request.id;
    untrack(() => target.scrollToIndex(request.row, 'center'));
  });

  // Tải thêm khi cuộn gần cuối (như Swift: còn ≤ 30 hàng); chống lặp khi lỗi: xem `autoLoadMore`.
  autoLoadMore(
    () => store,
    () => rangeEnd,
  );

  // --- kéo đổi độ rộng cột ---
  interface Drag {
    id: SizedColumn;
    startX: number;
    startWidth: number;
  }
  let drag: Drag | null = null;

  function beginResize(id: SizedColumn, event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { id, startX: event.clientX, startWidth: columns.widths[id] ?? DEFAULT_WIDTHS[id] };
    event.preventDefault();
  }

  function moveResize(event: PointerEvent): void {
    if (!drag) return;
    setWidth(drag.id, drag.startWidth + event.clientX - drag.startX);
  }

  function endResize(): void {
    drag = null;
  }

  function setWidth(id: SizedColumn, width: number): void {
    prefs.update({ columns: { ...prefs.value.columns, [id]: clampWidth(id, width) } });
  }

  function resizeKey(id: SizedColumn, event: KeyboardEvent): void {
    // Phím trên thanh đổi rộng là của thanh đó: không để lan lên các bộ xử lý phím bao quanh (vd. Home/End/↑/↓ chọn hàng).
    event.stopPropagation();
    const step = event.shiftKey ? 30 : 10;
    const current = columns.widths[id] ?? DEFAULT_WIDTHS[id];
    if (event.key === 'ArrowLeft') setWidth(id, current - step);
    else if (event.key === 'ArrowRight') setWidth(id, current + step);
    else if (event.key === 'Home') setWidth(id, DEFAULT_WIDTHS[id]);
    else return;
    event.preventDefault();
  }

  const resizable: readonly SizedColumn[] = ['refs', 'author', 'date', 'sha'];
  const isResizable = (id: ColumnId): id is SizedColumn => (resizable as readonly string[]).includes(id);
</script>

{#snippet resizer(id: SizedColumn)}
  <!-- Thanh chia cột có thể focus (mẫu "window splitter" của WAI-ARIA): Svelte coi `separator` là phần tử tĩnh nên cần bỏ qua cảnh báo. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label={vi.graph.resizeColumn(titles[id])}
    aria-valuenow={columns.widths[id]}
    aria-valuemin={COLUMN_LIMITS[id].min}
    aria-valuemax={COLUMN_LIMITS[id].max}
    tabindex="0"
    onpointerdown={(event) => beginResize(id, event)}
    onpointermove={moveResize}
    onpointerup={endResize}
    onpointercancel={endResize}
    onlostpointercapture={endResize}
    onkeydown={(event) => resizeKey(id, event)}
    ondblclick={() => setWidth(id, DEFAULT_WIDTHS[id])}
  ></div>
{/snippet}

{#snippet row(entry: GraphEntry, index: number)}
  {@const commit = entry.commit}
  {@const isWip = isWorkingTreeCommit(commit)}
  <!--
    Bàn phím do hộp `listbox` bên ngoài xử lý (↑↓/PageUp/PageDown/Home/End/Enter). Hàng ảo hoá bị gỡ khỏi DOM khi cuộn đi; nếu
    focus nằm ở hàng thì phím mũi tên ngừng hoạt động, nên bấm hàng xong là chuyển focus về hộp listbox.
  -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="g-row"
    class:selected={index === selectedRow}
    class:wip={isWip}
    id={rowId(index)}
    role="option"
    aria-selected={index === selectedRow}
    aria-posinset={index + 1}
    aria-setsize={store.entries.length}
    tabindex="-1"
    onclick={() => {
      selectRow(index);
      graphElement?.focus({ preventScroll: true });
    }}
    ondblclick={() => onactivate?.(entry)}
    onpointerdown={(event) => beginPillDrag(event, entry)}
    oncontextmenu={(event) => {
      selectRow(index);
      menus.openAt(event, commitMenu(store, entry));
    }}
  >
    <div class="cell refs">
      {#if entry.labels.length > 0}
        {@const placement = layoutPills(entry.labels, refsWidth, (text) =>
          measurePillText(showBidi(text), fontFamily),
        )}
        {@const lane = laneColor(laneColors, entry.row.color, '#8a93a3')}
        {#each placement.pills as pill (pill.index)}
          {@const label = entry.labels[pill.index]}
          {#if label}
            {@const look = pillAppearance(label, lane)}
            {@const primary = label.isDetachedHead
              ? undefined
              : (label.refs.find((ref) => ref.kind === 'localBranch') ?? label.refs[0])}
            <span
              class="pill"
              class:current={label.isCurrentBranch}
              data-drop={primary ? dropAttr('ref', primary.fullName) : undefined}
              style:left="{pill.x}px"
              style:width="{pill.width}px"
              style:--pill-top={look.top}
              style:--pill-bottom={look.bottom}
              style:--pill-rim={look.rim}
              style:--pill-rim-width="{look.rimWidth}px"
              style:--pill-edge={look.edge}
              title={showBidi(pillTooltip(label))}
            >
              {#each pillIcons(label) as icon (icon)}
                <Icon name={icon} size={PILL.iconSize} strokeWidth={2.6} />
              {/each}
              <span class="pill-text"><bdi>{showBidi(label.text)}</bdi></span>
            </span>
          {/if}
        {/each}
        {#if placement.more}
          <span
            class="more"
            style:left="{placement.more.x}px"
            title={showBidi(
              entry.labels
                .slice(entry.labels.length - placement.more.count)
                .map((label) => label.text)
                .join('\n'),
            )}
          >
            {vi.graph.pillMore(placement.more.count)}
          </span>
        {/if}
        <span class="connector" style:left="{placement.end}px" style:--lane={lane}></span>
      {/if}
    </div>
    <div class="cell graph-cell"></div>
    <div class="cell message" title={isWip ? vi.graph.wipTooltip : showBidi(commit.subject)}>
      {#if isWip}
        <span class="wip-label">{vi.graph.wip}</span>
        {#if wipSummary}<span class="wip-summary">{wipSummary}</span>{/if}
      {:else}
        <span class="subject selectable" class:merge={isMergeCommit(commit)}
          ><bdi>{showBidi(commit.subject)}</bdi></span
        >
      {/if}
    </div>
    {#if visible.has('author')}
      <div
        class="cell author"
        title={isWip ? undefined : showBidi(`${commit.authorName} <${commit.authorEmail}>`)}
      >
        {#if !isWip}<span class="selectable"><bdi>{showBidi(commit.authorName)}</bdi></span>{/if}
      </div>
    {/if}
    {#if visible.has('date')}
      <div class="cell date" title={isWip ? undefined : formatAbsolute(commit.authorDate)}>
        {#if !isWip}<span class="selectable">{formatCommitTime(commit.authorDate, { relative })}</span>{/if}
      </div>
    {/if}
    {#if visible.has('sha')}
      <div class="cell sha">
        {#if !isWip}<span class="selectable">{shortSha(commit)}</span>{/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet overlay(range: { start: number; end: number })}
  <GraphCanvasLayer
    entries={store.entries}
    version={store.graphVersion}
    headOid={store.headOid}
    width={graphWidthPx}
    left={refsWidth}
    start={range.start}
    end={range.end}
    themeVersion={theme.version}
  />
{/snippet}

<div class="graph-table" style={tableStyle}>
  <!-- Tiêu đề cột nằm NGOÀI listbox: listbox chỉ chứa các hàng (option) để trình đọc màn hình đếm đúng "mục x / tổng". -->
  <div class="header" role="presentation" style:width="{rowsWidth}px">
    {#each columns.visible as id (id)}
      <div class="hcell col-{id}" role="presentation">
        <span class="htitle">{titles[id]}</span>
        {#if isResizable(id)}{@render resizer(id)}{/if}
      </div>
    {/each}
  </div>

  <div class="body">
    <div
      bind:this={graphElement}
      class="rows"
      role="listbox"
      aria-label={vi.graph.ariaLabel}
      aria-activedescendant={activeDescendant}
      tabindex="0"
      onkeydown={onKeydown}
    >
      <VirtualList
        bind:this={list}
        bind:contentWidth={rowsWidth}
        items={store.entries}
        rowHeight={ROW}
        overscan={OVERSCAN}
        key={(entry) => entry.commit.id}
        {row}
        {overlay}
        onrange={(range) => {
          rangeStart = range.start;
          rangeEnd = range.end;
        }}
      />
    </div>
    {#if showLoading}
      <div class="state" role="status">{vi.graph.loading}</div>
    {:else if showError}
      <div class="state error" role="alert">
        <strong>{vi.errors.history}</strong>
        <span class="selectable">{store.historyError}</span>
      </div>
    {:else if showEmpty}
      <div class="state">
        <strong>{vi.graph.emptyTitle}</strong>
        <span>{vi.graph.emptyHint}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .graph-table {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    position: relative;
  }

  /* Hộp listbox (nhận focus bàn phím) phủ kín vùng thân; không vẽ viền focus: hàng được chọn đổi sang màu nhấn khi bảng có focus. */
  .rows {
    height: 100%;
    outline: none;
  }

  .header {
    display: flex;
    flex: none;
    height: 28px;
    background: var(--table-header-fill);
    border-bottom: 1px solid var(--separator);
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
  }

  .hcell {
    position: relative;
    display: flex;
    align-items: center;
    flex: none;
    min-width: 0;
    padding: 0 8px;
    white-space: nowrap;
  }

  .hcell.col-refs {
    width: var(--w-refs);
  }
  .hcell.col-graph {
    width: var(--w-graph);
  }
  .hcell.col-message {
    flex: 1 1 0;
  }
  .hcell.col-author {
    width: var(--w-author);
  }
  .hcell.col-date {
    width: var(--w-date);
  }
  .hcell.col-sha {
    width: var(--w-sha);
  }

  .htitle {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Vạch ngăn giữa các tiêu đề; vùng bấm kéo rộng hơn vạch. */
  .hcell::after {
    content: '';
    position: absolute;
    right: 0;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: var(--separator);
  }
  .hcell:last-child::after {
    display: none;
  }

  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -4px;
    width: 9px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
  }
  .resizer:hover,
  .resizer:focus-visible {
    background: var(--selection);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .g-row {
    display: flex;
    align-items: center;
    height: 100%;
    font-size: 13px;
  }

  .g-row:hover {
    background: var(--row-hover);
  }

  .g-row.selected {
    background: var(--row-selected);
  }

  .graph-table:focus-within .g-row.selected {
    background: var(--row-selected-focus);
  }

  .cell {
    flex: none;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .cell > span {
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  .cell.refs {
    position: relative;
    width: var(--w-refs);
    padding: 0;
    overflow: hidden;
  }
  .cell.graph-cell {
    width: var(--w-graph);
    padding: 0;
  }
  .cell.message {
    flex: 1 1 0;
    font-size: 13px;
    color: var(--text);
  }
  .cell.author {
    width: var(--w-author);
  }
  .cell.date {
    width: var(--w-date);
  }
  .cell.sha {
    width: var(--w-sha);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .subject.merge {
    color: var(--text-secondary);
  }

  .wip-label {
    flex: none;
    font-style: italic;
    color: var(--text-secondary);
  }
  .wip-summary {
    margin-left: 14px;
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: pre;
  }

  /* --- nhãn nhánh/tag kiểu kính --- */
  .pill {
    position: absolute;
    top: 50%;
    height: 18px;
    margin-top: -9px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 7px;
    border-radius: 9px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    text-shadow: 0 0.5px 1px rgb(0 0 0 / 0.3);
    background: linear-gradient(to bottom, var(--pill-top), var(--pill-bottom));
    box-shadow:
      inset 0 0 0 var(--pill-rim-width) var(--pill-rim),
      0 0 0 0.75px var(--pill-edge);
    overflow: hidden;
    white-space: nowrap;
  }

  .pill-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more {
    position: absolute;
    top: 50%;
    width: 26px;
    height: 18px;
    margin-top: -9px;
    border-radius: 9px;
    background: var(--chip-fill);
    color: var(--text);
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }

  /* Đường nối từ nhãn sang node (phần trong cột Nhánh/Tag; phần trong cột Graph do canvas vẽ). */
  .connector {
    position: absolute;
    top: 50%;
    right: 0;
    height: 1.5px;
    margin-top: -0.75px;
    background: var(--lane);
    opacity: 0.55;
  }

  .state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
    pointer-events: none;
  }
  .state strong {
    color: var(--text);
    font-size: 14px;
  }
  .state.error {
    pointer-events: auto;
    color: var(--danger);
  }
</style>
