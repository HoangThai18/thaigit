<!--
  Cửa sổ repo: sidebar | graph | inspector như app Swift (RepoWindowView.swift). Sidebar cao hết cửa sổ, thanh công cụ nằm trên
  graph + inspector. Kính CHỈ ở chrome (sidebar, thanh công cụ, inspector) — vùng graph không có backdrop-filter để giữ 60 fps.
  Thanh công cụ ở 4a chỉ có tên repo/nhánh và hai nút (ẩn/hiện panel, đóng); Fetch/Pull/Push/Branch… thuộc 4b.
-->
<script lang="ts">
  import { operationCanContinue, operationCanSkip, operationTitle } from '@thaigit/core';
  import { abortOperation, continueOperation, skipOperation } from '../actions/history.ts';
  import { beginCreateBranch } from '../actions/branches.ts';
  import { startAutoFetch } from '../actions/autoFetch.ts';
  import { completeHistory, fetch, pull, push } from '../actions/remote.ts';
  import ConflictPane from '../diff/ConflictPane.svelte';
  import DiffPane from '../diff/DiffPane.svelte';
  import { showBidi } from '../format/bidi.ts';
  import GraphView from '../graph/GraphView.svelte';
  import SearchBar from '../graph/SearchBar.svelte';
  import { GraphSearch } from '../graph/search.svelte.ts';
  import { untrack } from 'svelte';
  import Inspector from '../inspector/Inspector.svelte';
  import Sidebar from '../sidebar/Sidebar.svelte';
  import { vi } from '../strings.vi.ts';
  import { INSPECTOR_LIMITS, SIDEBAR_LIMITS, prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import { dialogs } from '../stores/dialogs.svelte.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { drag } from '../dnd/drag.svelte.ts';
  import { canDrop, dropAction } from '../dnd/dropMenu.ts';
  import DragGhost from '../dnd/DragGhost.svelte';
  import ActionBar from './ActionBar.svelte';
  import BranchSwitcher from './BranchSwitcher.svelte';
  import BusyBar from './BusyBar.svelte';
  import CommandLogPanel from './CommandLogPanel.svelte';
  import Splitter from './Splitter.svelte';

  interface Props {
    store: RepoStore;
    onclose: () => void;
  }

  let { store, onclose }: Props = $props();

  const showSidebar = $derived(prefs.value.showSidebar);
  const showInspector = $derived(prefs.value.showInspector);
  const conflicts = $derived(store.status.conflicts.length);
  const gaps = $derived(store.historyGaps);
  const showGaps = $derived(
    !store.historyGapsDismissed &&
      store.remotes.length > 0 &&
      (gaps.shallow || gaps.narrowRemotes.length > 0),
  );
  let showLog = $state(false);
  const search = untrack(() => new GraphSearch(store));

  $effect(() => startAutoFetch(store));

  // Kéo-thả: nhánh / tag lên nhánh hoặc remote (menu chọn thao tác), file giữa "Chưa stage" và "Đã stage".
  $effect(() => {
    const repo = store;
    drag.handler = {
      canDrop: (payload, target) => canDrop(repo, payload, target),
      drop: (payload, target, point) => {
        const items = dropAction(repo, payload, target);
        if (items && items.length > 0) menus.openAtPoint(point.x, point.y, items);
      },
    };
    return () => {
      drag.cancel();
      drag.handler = null;
    };
  });

  /** Phím tắt của repo (Ctrl trên Windows/Linux, ⌘ trên macOS) — như menu Repository của app Swift. */
  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || menus.current !== null || showLog) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const code = event.code;
    if (!event.shiftKey && !event.altKey && code === 'KeyF' && store.diff.file === null) {
      event.preventDefault();
      search.show();
      return;
    }
    if (event.altKey && !event.shiftKey && code === 'KeyF') void fetch(store);
    else if (event.shiftKey && !event.altKey && code === 'KeyL') void pull(store);
    else if (event.shiftKey && !event.altKey && code === 'KeyP') void push(store);
    else if (event.shiftKey && !event.altKey && code === 'KeyB') void beginCreateBranch(store);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<DragGhost />

{#snippet sidebarToggle()}
  <button
    type="button"
    class="tool"
    class:active={showSidebar}
    title={vi.window.toggleSidebar}
    aria-label={vi.window.toggleSidebar}
    aria-pressed={showSidebar}
    onclick={() => prefs.update({ showSidebar: !showSidebar })}
  >
    <Icon name="sidebar-left" size={18} />
  </button>
{/snippet}

<div class="window">
  {#if showSidebar}
    <aside class="sidebar-pane" style:width="{prefs.value.sidebarWidth}px">
      <div class="band" data-tauri-drag-region>
        <span class="inset" data-tauri-drag-region></span>
        {@render sidebarToggle()}
      </div>
      <div class="sidebar-body"><Sidebar {store} /></div>
    </aside>
    <Splitter
      value={prefs.value.sidebarWidth}
      min={SIDEBAR_LIMITS.min}
      max={SIDEBAR_LIMITS.max}
      side="left"
      label={vi.window.resizeSidebar}
      onchange={(width) => prefs.update({ sidebarWidth: width })}
    />
  {/if}

  <div class="main">
    <header class="toolbar" data-tauri-drag-region>
      {#if !showSidebar}
        <span class="inset" data-tauri-drag-region></span>
        {@render sidebarToggle()}
      {/if}
      <BranchSwitcher {store} />
      <div class="titles" data-tauri-drag-region>
        <strong class="repo-name" data-tauri-drag-region><bdi>{showBidi(store.name)}</bdi></strong>
        <span class="subtitle" data-tauri-drag-region><bdi>{showBidi(store.branchSubtitle)}</bdi></span>
      </div>
      <span class="grow" data-tauri-drag-region></span>
      <ActionBar {store} onshowlog={() => (showLog = true)} onsearch={() => search.show()} />
      <span class="divider" data-tauri-drag-region></span>
      <button
        type="button"
        class="tool"
        class:active={showInspector}
        title={vi.window.toggleInspector}
        aria-label={vi.window.toggleInspector}
        aria-pressed={showInspector}
        onclick={() => prefs.update({ showInspector: !showInspector })}
      >
        <Icon name="sidebar-right" size={18} />
      </button>
      <button
        type="button"
        class="tool"
        title={vi.window.closeRepo}
        aria-label={vi.window.closeRepo}
        onclick={onclose}
      >
        <Icon name="x" size={16} />
      </button>
    </header>

    <BusyBar {store} />

    <div class="content">
      <div class="center">
        {#if showGaps}
          <div class="banner info" role="status">
            <span class="banner-icon"><Icon name="info" size={18} /></span>
            <span class="banner-text">
              <strong>{vi.remote.historyGapsTitle(gaps.narrowRemotes.length > 0)}</strong>
              <span class="banner-detail">
                {gaps.narrowRemotes.length > 0 ? vi.remote.historyGapsNarrow(gaps.narrowRemotes) : ''}
                {gaps.shallow ? vi.remote.historyGapsShallow : ''}
              </span>
            </span>
            <span class="grow"></span>
            <button type="button" class="banner-button" onclick={() => (store.historyGapsDismissed = true)}>
              {vi.remote.later}
            </button>
            <button
              type="button"
              class="banner-button primary"
              title={vi.remote.completeHistoryTip}
              disabled={store.busy !== null}
              onclick={() => void completeHistory(store)}
            >
              {vi.remote.completeHistory}
            </button>
          </div>
        {/if}
        {#if store.operation}
          <div class="banner" role="status">
            <span class="banner-icon"><Icon name="warning" size={18} /></span>
            <strong>{operationTitle(store.operation)}</strong>
            <span class="banner-detail"
              >{conflicts > 0 ? vi.window.operationConflicts(conflicts) : vi.window.operationResolved}</span
            >
            <span class="grow"></span>
            <button type="button" class="banner-button" onclick={() => void abortOperation(store)}>
              {vi.branches.abortOperation}
            </button>
            {#if operationCanSkip(store.operation)}
              <button type="button" class="banner-button" onclick={() => void skipOperation(store)}>
                {vi.branches.skipOperation}
              </button>
            {/if}
            {#if operationCanContinue(store.operation)}
              <button
                type="button"
                class="banner-button primary"
                disabled={conflicts > 0}
                onclick={() => void continueOperation(store)}
              >
                {vi.branches.continueOperation}
              </button>
            {/if}
          </div>
        {/if}
        <!-- Graph giữ nguyên khi mở diff (ẩn đi) để quay lại không phải dựng lại / mất vị trí cuộn. -->
        <div class="graph-area" class:hidden={store.diff.file !== null}>
          <GraphView {store} {search} />
          <SearchBar {search} />
        </div>
        {#if store.diff.file?.source.kind === 'conflict'}
          <div class="graph-area"><ConflictPane {store} /></div>
        {:else if store.diff.file !== null}
          <div class="graph-area"><DiffPane {store} /></div>
        {/if}
      </div>
      {#if showInspector}
        <Splitter
          value={prefs.value.inspectorWidth}
          min={INSPECTOR_LIMITS.min}
          max={INSPECTOR_LIMITS.max}
          side="right"
          label={vi.window.resizeInspector}
          onchange={(width) => prefs.update({ inspectorWidth: width })}
        />
        <aside class="inspector-pane" style:width="{prefs.value.inspectorWidth}px">
          <Inspector {store} />
        </aside>
      {/if}
    </div>
  </div>
</div>

{#if showLog}
  <CommandLogPanel {store} onclose={() => (showLog = false)} />
{/if}

<style>
  .window {
    display: flex;
    height: 100%;
    min-width: 0;
  }

  .sidebar-pane {
    display: flex;
    flex-direction: column;
    flex: none;
    min-width: 0;
    background: var(--sidebar-fill);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  .band {
    display: flex;
    align-items: center;
    flex: none;
    height: 52px;
    gap: 6px;
    padding-right: 10px;
  }

  .sidebar-body {
    flex: 1;
    min-height: 0;
  }

  /* Chừa chỗ cho nút đèn giao thông của macOS (chỉ khi cửa sổ dùng thanh tiêu đề chồng). */
  .inset {
    flex: none;
    width: var(--titlebar-inset);
    align-self: stretch;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    flex: none;
    height: 52px;
    gap: 10px;
    padding: 0 12px 0 12px;
    background: var(--toolbar-fill);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--separator);
  }

  .tool {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
  }

  .tool:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .tool.active {
    color: var(--text);
  }

  .titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  .repo-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: 11.5px;
  }

  .grow {
    flex: 1;
    align-self: stretch;
  }

  .divider {
    flex: none;
    width: 1px;
    height: 20px;
    background: var(--separator);
  }

  .content {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .center {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .graph-area {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* Không dùng display: none — giữ khung cuộn của graph (vị trí cuộn) khi mở diff rồi quay lại. */
  .graph-area.hidden {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .inspector-pane {
    flex: none;
    min-width: 0;
    background: var(--inspector-fill);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  .banner {
    display: flex;
    align-items: center;
    flex: none;
    gap: 10px;
    margin: 8px 10px 0;
    padding: 8px 14px;
    border: 1px solid var(--glass-rim);
    border-radius: 14px;
    background: var(--glass-fill);
    box-shadow: inset 4px 0 0 var(--warning);
    font-size: 13px;
  }

  .banner-icon {
    display: grid;
    color: var(--warning);
  }

  .banner.info {
    box-shadow: inset 4px 0 0 var(--accent);
  }

  .banner.info .banner-icon {
    color: var(--accent);
  }

  .banner-text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 8px;
    min-width: 0;
  }

  .banner-detail {
    color: var(--text-secondary);
  }

  .banner-button {
    flex: none;
    padding: 4px 12px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .banner-button.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .banner-button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
