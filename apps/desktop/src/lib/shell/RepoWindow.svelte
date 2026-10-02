<!--
  Cửa sổ repo: sidebar | graph | inspector như app Swift (RepoWindowView.swift). Sidebar cao hết cửa sổ, thanh công cụ nằm trên
  graph + inspector. Kính CHỈ ở chrome (sidebar, thanh công cụ, inspector) — vùng graph không có backdrop-filter để giữ 60 fps.
  Thanh công cụ ở 4a chỉ có tên repo/nhánh và hai nút (ẩn/hiện panel, đóng); Fetch/Pull/Push/Branch… thuộc 4b.
-->
<script lang="ts">
  import { operationTitle } from '@thaigit/core';
  import GraphView from '../graph/GraphView.svelte';
  import Inspector from '../inspector/Inspector.svelte';
  import Sidebar from '../sidebar/Sidebar.svelte';
  import { vi } from '../strings.vi.ts';
  import { INSPECTOR_LIMITS, SIDEBAR_LIMITS, prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import Splitter from './Splitter.svelte';

  interface Props {
    store: RepoStore;
    onclose: () => void;
  }

  let { store, onclose }: Props = $props();

  const showSidebar = $derived(prefs.value.showSidebar);
  const showInspector = $derived(prefs.value.showInspector);
  const conflicts = $derived(store.status.conflicts.length);
</script>

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
      <div class="branch" title={vi.window.branchLabel}>
        <Icon name="branch" size={15} />
        <span class="branch-name">{store.headDescription || vi.window.noBranch}</span>
      </div>
      <div class="titles" data-tauri-drag-region>
        <strong class="repo-name" data-tauri-drag-region>{store.name}</strong>
        <span class="subtitle" data-tauri-drag-region>{store.branchSubtitle}</span>
      </div>
      <span class="grow" data-tauri-drag-region></span>
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

    <div class="content">
      <div class="center">
        {#if store.operation}
          <div class="banner" role="status">
            <span class="banner-icon"><Icon name="warning" size={18} /></span>
            <strong>{operationTitle(store.operation)}</strong>
            <span class="banner-detail"
              >{conflicts > 0 ? vi.window.operationConflicts(conflicts) : vi.window.operationResolved}</span
            >
          </div>
        {/if}
        <div class="graph-area"><GraphView {store} /></div>
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

  .branch {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 7px;
    max-width: 260px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--glass-rim);
    border-radius: 15px;
    background: var(--glass-fill);
    color: var(--text-secondary);
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: 13px;
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

  .content {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .center {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .graph-area {
    flex: 1;
    min-height: 0;
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

  .banner-detail {
    color: var(--text-secondary);
  }
</style>
