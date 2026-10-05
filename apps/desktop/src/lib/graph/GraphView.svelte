<!--
  Commit table + graph (port of CommitGraphView.swift): text columns use 30px virtualised DOM rows (selectable,
  copyable text) while a SINGLE canvas over the Graph column paints only the visible slice. Columns are
  user-resizable and auto collapse/hide when narrow using the Swift rules; Up/Down selects a commit; more
  history loads when scrolling near the end.
-->
<script lang="ts">
  import type { GraphSearch } from './search.svelte.ts';
  import { drag as dragDrop, dropAttr, parseDropTarget } from '../dnd/drag.svelte.ts';
  import { changedFileCount, isMergeCommit, isWorkingTreeCommit, shortSha } from '@thaigit/core';
  import { untrack } from 'svelte';
  import { checkout } from '../actions/branches.ts';
  import { repoForgeTarget } from '../forge/target.ts';
  import { loadIdentity } from '../actions/identity.ts';
  import { commitMenu, labelsMenu } from '../actions/menus.ts';
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
  import { avatars } from './avatars.svelte.ts';
  import GraphCanvasLayer from './GraphCanvasLayer.svelte';
  import { measurePillText } from './measure.ts';
  import { layoutPills, pillAppearance, pillIcons, pillTooltip, PILL, type RefLabel } from './pills.ts';
  import { GraphStyle, laneColor, readLaneColors } from './style.ts';
  import { workingTreeSummary } from './wip.ts';

  interface Props {
    store: RepoStore;
    /** Double-click / Enter on a row (checkout happens in a later phase). */
    onactivate?: (entry: GraphEntry) => void;
    /** Active search: highlight matching rows, dim the rest. */
    search?: GraphSearch;
  }

  let { store, onactivate, search }: Props = $props();

  const ROW = GraphStyle.rowHeight;
  const laneColors = readLaneColors(document.documentElement);
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim();

  /** Extra rows rendered beyond the visible range on each side (fed to VirtualList; also tells us which rows exist in the DOM). */
  const OVERSCAN = 14;
  // Row ids must be unique document-wide (several GraphViews can be alive at once), so use the component's own prefix.
  const uid = $props.id();
  const rowId = (index: number): string => `${uid}-row-${index}`;

  let list = $state<VirtualList<GraphEntry>>();
  let graphElement = $state<HTMLDivElement>();
  let rowsWidth = $state(0);
  let rangeStart = $state(0);
  let rangeEnd = $state(0);

  // --- columns ---
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
  // `aria-activedescendant` may only point at an element that is in the DOM: the virtualised list removes rows
  // outside the rendered range, so when the selected row falls outside it we drop the attribute (falling back to
  // the listbox itself) instead of leaving a dangling id.
  const activeDescendant = $derived(
    selectedRow !== null &&
      selectedRow >= Math.max(0, rangeStart - OVERSCAN) &&
      selectedRow < Math.min(store.entries.length, rangeEnd + OVERSCAN)
      ? rowId(selectedRow)
      : undefined,
  );
  const relative = $derived(prefs.value.relativeDates);
  /** Uncommitted file count: shown on the pill of the checked-out branch (those changes belong to the branch, not to the "// WIP" row). */
  const pendingCount = $derived(changedFileCount(store.status));
  /** With a detached HEAD there is no branch to hang the file count on, so the WIP row states its own change count. */
  const pendingOnCurrent = $derived(store.currentBranch === null ? 0 : pendingCount);
  const wipSummary = $derived(workingTreeSummary(store.status));
  const showLoading = $derived(!store.hasLoaded);
  const showError = $derived(store.hasLoaded && store.historyError !== null && store.entries.length === 0);
  const showEmpty = $derived(store.hasLoaded && store.historyError === null && store.entries.length === 0);

  /** GitHub repo of the open repo (from the `origin` remote): Rust uses it to find avatars via the commits API. */
  const githubTarget = $derived.by(() => {
    const target = repoForgeTarget(store.remotes);
    return target?.provider === 'github' ? { owner: target.owner, name: target.repo } : null;
  });

  /** Email of the current committer: the WIP row node draws that person's avatar. */
  let wipEmail = $state<string | null>(null);
  $effect(() => {
    let alive = true;
    void loadIdentity(store).then((identity) => {
      if (alive) wipEmail = identity.email;
    });
    return () => {
      alive = false;
    };
  });

  // GitHub repo of the open repo (so Rust can find avatars via the commits API). Already downloaded avatars stay cached in memory.
  $effect(() => {
    avatars.setEnabled(prefs.value.showAvatars);
    avatars.github = githubTarget;
  });

  /** Load avatars for the visible rows (including rows just scrolled in); Rust caches them, so later passes are cheap. */
  $effect(() => {
    if (!avatars.enabled) return;
    const first = Math.max(0, rangeStart - OVERSCAN);
    const last = Math.min(store.entries.length, rangeEnd + OVERSCAN);
    for (let index = first; index < last; index++) {
      const commit = store.entryAt(index)?.commit;
      if (!commit) continue;
      avatars.ensure(isWorkingTreeCommit(commit) ? (wipEmail ?? '') : commit.authorEmail);
    }
  });

  // --- row selection, keyboard ---
  /** Press and hold on a branch/tag label then drag: drop on another branch to merge / rebase, on a remote to push. */
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

  /** Popover shown when hovering "+N": the branches / tags folded into it (like GitKraken). */
  let moreHover = $state<{ x: number; y: number; labels: readonly RefLabel[] } | null>(null);

  function showMore(event: PointerEvent, labels: readonly RefLabel[]): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    moreHover = { x: rect.left, y: rect.bottom + 4, labels };
  }

  function openMore(event: MouseEvent, index: number, labels: readonly RefLabel[]): void {
    event.stopPropagation();
    moreHover = null;
    selectRow(index);
    menus.openBelow(event.currentTarget as HTMLElement, labelsMenu(store, labels));
  }

  /** Double-click a label: check out exactly that branch (not the topmost one). */
  function activatePill(event: MouseEvent, label: RefLabel): void {
    const ref =
      label.refs.find((item) => item.kind === 'localBranch') ??
      label.refs.find((item) => item.kind === 'remoteBranch');
    if (!ref || label.isDetachedHead) return;
    event.stopPropagation();
    void checkout(store, ref);
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

  // Scroll to a row when the store asks for it (selecting a branch in the sidebar, clicking a parent commit,
  // first-time select). Each request is handled only ONCE, and the `scrollToIndex` call sits inside `untrack`:
  // it reads `items.length` (reactive) internally, so without it every graph reload would re-run the effect
  // and scroll back to the row of an already handled request.
  let handledScrollId = 0;
  $effect(() => {
    const request = store.scrollRequest;
    const target = list;
    if (!request || !target || request.id === handledScrollId) return;
    handledScrollId = request.id;
    untrack(() => target.scrollToIndex(request.row, 'center'));
  });

  // Load more when scrolling near the end (like Swift: ≤ 30 rows left); retry loop guard on failure: see `autoLoadMore`.
  autoLoadMore(
    () => store,
    () => rangeEnd,
  );

  // --- column width drag ---
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
    // Keys pressed on a resize bar belong to that bar: don't let them bubble to the surrounding key handlers (e.g. Home/End/Up/Down row selection).
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
  <!-- Focusable column divider (the WAI-ARIA "window splitter" pattern): Svelte treats `separator` as a static element, hence the ignored warnings. -->
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
    Keyboard handling lives on the outer `listbox` (Up/Down/PageUp/PageDown/Home/End/Enter). Virtualised rows are
    removed from the DOM once scrolled away; if focus sits on a row the arrow keys stop working, so clicking a row
    moves focus back to the listbox.
  -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="g-row"
    class:selected={index === selectedRow}
    class:wip={isWip}
    class:match={search?.active === true && search.matchSet.has(index)}
    class:dim={search?.active === true && !search.matchSet.has(index)}
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
    ondblclick={(event) => {
      // Double-click on a label checks out that exact branch; anywhere else in the row behaves as before (onactivate).
      const pill = (event.target as HTMLElement | null)?.closest('[data-pill]')?.getAttribute('data-pill');
      const label = pill == null ? undefined : entry.labels[Number(pill)];
      if (label) activatePill(event, label);
      else onactivate?.(entry);
    }}
    onpointerdown={(event) => beginPillDrag(event, entry)}
    oncontextmenu={(event) => {
      selectRow(index);
      menus.openAt(event, commitMenu(store, entry));
    }}
  >
    <div class="cell refs">
      {#if entry.labels.length > 0}
        {@const placement = layoutPills(
          entry.labels,
          refsWidth,
          (text) => measurePillText(showBidi(text), fontFamily),
          pendingOnCurrent,
        )}
        {@const lane = laneColor(laneColors, entry.row.color, '#8a93a3')}
        {#each placement.pills as pill (pill.index)}
          {@const label = entry.labels[pill.index]}
          {#if label}
            {@const look = pillAppearance(label, lane)}
            {@const primary = label.isDetachedHead
              ? undefined
              : (label.refs.find((ref) => ref.kind === 'localBranch') ?? label.refs[0])}
            {@const badge =
              label.isCurrentBranch && pendingOnCurrent > 0 ? vi.graph.pillPending(pendingOnCurrent) : null}
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
              title={showBidi(badge === null ? pillTooltip(label) : `${pillTooltip(label)}\n${wipSummary}`)}
              data-pill={pill.index}
            >
              {#each pillIcons(label) as icon (icon)}
                <Icon name={icon} size={PILL.iconSize} strokeWidth={2.6} />
              {/each}
              <span class="pill-text"><bdi>{showBidi(label.text)}</bdi></span>
              {#if badge}<span class="pill-badge">{badge}</span>{/if}
            </span>
          {/if}
        {/each}
        {#if placement.more}
          {@const hidden = entry.labels.slice(entry.labels.length - placement.more.count)}
          <button
            type="button"
            class="more"
            style:left="{placement.more.x}px"
            aria-label={vi.graph.moreTitle(placement.more.count)}
            aria-haspopup="menu"
            onpointerenter={(event) => showMore(event, hidden)}
            onpointerleave={() => (moreHover = null)}
            onclick={(event) => openMore(event, index, hidden)}
            ondblclick={(event) => event.stopPropagation()}
          >
            {vi.graph.pillMore(placement.more.count)}
          </button>
        {/if}
        <span class="connector" style:left="{placement.end}px" style:--lane={lane}></span>
      {/if}
    </div>
    <div
      class="cell graph-cell"
      title={isWip
        ? undefined
        : vi.graph.pillAuthor(commit.authorName, commit.authorEmail, formatAbsolute(commit.authorDate))}
    ></div>
    <div class="cell message" title={isWip ? vi.graph.wipTooltip : showBidi(commit.subject)}>
      {#if isWip}
        <span class="wip-label">{vi.graph.wip}</span>
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
    {avatars}
    {wipEmail}
  />
{/snippet}

<div class="graph-table" style={tableStyle}>
  <!-- The column header sits OUTSIDE the listbox: the listbox only holds the rows (options) so screen readers report "item x of y" correctly. -->
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

{#if moreHover}
  <div class="more-card" style:left="{moreHover.x}px" style:top="{moreHover.y}px" role="tooltip">
    {#each moreHover.labels as label, index (index)}
      <div class="more-row" class:current={label.isCurrentBranch}>
        <Icon name={label.isTag ? 'tag' : label.hasLocal ? 'branch' : 'cloud'} size={12} />
        <span><bdi>{showBidi(label.text)}</bdi></span>
      </div>
    {/each}
    <div class="more-hint">{vi.graph.moreHint}</div>
  </div>
{/if}

<style>
  .graph-table {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    position: relative;
  }

  /* The listbox (keyboard focus target) covers the whole body area; no focus outline: the selected row switches to the pressed colour whenever the table has focus. */
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

  /* Divider between headers; the drag target is wider than the visual line. */
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

  .g-row.dim {
    opacity: 0.38;
  }

  .g-row.match:not(.selected) {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
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

  /* --- glass-style branch/tag labels --- */
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

  /* Badge with the uncommitted file count: sits inside the pill, next to the checked-out branch name. */
  .pill-badge {
    flex: none;
    margin-left: 5px;
    padding: 0 4px;
    border-radius: 7px;
    background: rgb(0 0 0 / 0.22);
    font-size: 10px;
    font-weight: 700;
    line-height: 13px;
  }

  .more {
    position: absolute;
    top: 50%;
    width: 26px;
    height: 18px;
    margin-top: -9px;
    padding: 0;
    border: none;
    border-radius: 9px;
    background: var(--chip-fill);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    cursor: pointer;
  }

  .more:hover {
    background: var(--row-hover);
  }

  .more-card {
    position: fixed;
    z-index: 800;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
    padding: 8px 10px;
    border: 1px solid var(--glass-rim);
    border-radius: var(--radius-m);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    font-size: 12.5px;
    pointer-events: none;
  }

  .more-row {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .more-row :global(svg) {
    color: var(--text-secondary);
  }

  .more-row.current {
    font-weight: 600;
  }

  .more-hint {
    margin-top: 2px;
    padding-top: 5px;
    border-top: 1px solid var(--separator);
    color: var(--text-tertiary);
    font-size: 11.5px;
  }

  /* Connector from a label to its node (the part inside the Refs column; the part inside the Graph column is painted by the canvas). */
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
