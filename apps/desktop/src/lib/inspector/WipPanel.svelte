<!--
  Panel thay đổi chưa commit (port StagingView.swift): xung đột, chưa stage, đã stage — bấm file để xem diff ở vùng giữa,
  nút Stage / Bỏ stage / Huỷ khi rê chuột, nhấp đúp để stage / bỏ stage nhanh; ô soạn commit ở dưới.
-->
<script lang="ts">
  import { conflictAsChange, type FileChange } from '@thaigit/core';
  import { resolveWhole } from '../actions/conflicts.ts';
  import { fileMenu } from '../actions/menus.ts';
  import { discardFiles, stageAll, stageFiles, unstageAll, unstageFiles } from '../actions/staging.ts';
  import { showBidi } from '../format/bidi.ts';
  import RiskBanner from '../risk/RiskBanner.svelte';
  import ChangeList from '../staging/ChangeList.svelte';
  import CommitComposer from '../staging/CommitComposer.svelte';
  import { vi } from '../strings.vi.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const status = $derived(store.status);
  const conflicts = $derived<readonly FileChange[]>(status.conflicts.map((entry) => conflictAsChange(entry)));
  const total = $derived(status.staged.length + status.unstaged.length + status.conflicts.length);
  const open = $derived(store.diff.file);
  const openUnstaged = $derived(open?.source.kind === 'unstaged' ? open.change.path : null);
  const openStaged = $derived(open?.source.kind === 'staged' ? open.change.path : null);
  const openConflict = $derived(open?.source.kind === 'conflict' ? open.change.path : null);

  function resolveFor(change: FileChange, useOurs: boolean): void {
    const entry = status.conflicts.find((candidate) => candidate.path === change.path);
    if (entry) void resolveWhole(store, entry, useOurs);
  }
</script>

<div class="wip">
  <header class="top">
    <span class="glyph"><Icon name="pencil" size={18} /></span>
    <div class="titles">
      <h2>{total === 0 ? vi.staging.clean : vi.staging.filesChanged(total)}</h2>
      {#if store.currentBranch}
        <span class="branch"><bdi>{showBidi(vi.staging.onBranch(store.currentBranch))}</bdi></span>
      {/if}
    </div>
    <button
      type="button"
      class="timeline-btn"
      title={vi.snapshots.openHint}
      aria-label={vi.snapshots.title}
      onclick={() => store.timeline.open()}
    >
      <Icon name="clock" size={14} />
      <span>{vi.snapshots.title}</span>
    </button>
  </header>

  <RiskBanner flags={store.risks.visible} ondismiss={() => store.risks.dismiss()} />

  {#if conflicts.length > 0}
    <div class="section conflicts">
      <ChangeList
        files={conflicts}
        title={vi.staging.conflictsTitle}
        actions={[
          { icon: 'checkout', title: vi.branches.useAllCurrent, run: (change) => resolveFor(change, true) },
          { icon: 'download', title: vi.branches.useAllIncoming, run: (change) => resolveFor(change, false) },
        ]}
        selectedPath={openConflict}
        onopen={(change) => store.diff.open(change, { kind: 'conflict' })}
      />
    </div>
  {/if}

  <!-- Danh sách đang trống thu nhỏ để danh sách kia hiện được nhiều file hơn (như GitKraken). -->
  <div class="section" class:compact={status.unstaged.length === 0 && status.staged.length > 0}>
    <ChangeList
      files={status.unstaged}
      title={vi.staging.unstagedTitle}
      dragFrom="unstaged"
      dropZone="unstaged"
      headerAction={{ title: vi.staging.stageAll, icon: 'stage', run: () => void stageAll(store) }}
      folderAction={{
        title: vi.staging.stageFolder,
        icon: 'stage',
        run: (changes) => void stageFiles(store, changes),
      }}
      actions={[
        {
          icon: 'discard',
          title: vi.staging.discardFile,
          destructive: true,
          run: (change) => void discardFiles(store, [change]),
        },
        { icon: 'stage', title: vi.staging.stageFile, run: (change) => void stageFiles(store, [change]) },
      ]}
      selectedPath={openUnstaged}
      emptyText={vi.staging.noUnstaged}
      onopen={(change) => store.diff.open(change, { kind: 'unstaged' })}
      onprimary={(change) => void stageFiles(store, [change])}
      onmenu={(event, change) => menus.openAt(event, fileMenu(store, change, { kind: 'unstaged' }))}
    />
  </div>

  <div class="section" class:compact={status.staged.length === 0}>
    <ChangeList
      files={status.staged}
      title={vi.staging.stagedTitle}
      dragFrom="staged"
      dropZone="staged"
      headerAction={{ title: vi.staging.unstageAll, icon: 'unstage', run: () => void unstageAll(store) }}
      folderAction={{
        title: vi.staging.unstageFolder,
        icon: 'unstage',
        run: (changes) => void unstageFiles(store, changes),
      }}
      actions={[
        {
          icon: 'unstage',
          title: vi.staging.unstageFile,
          run: (change) => void unstageFiles(store, [change]),
        },
      ]}
      selectedPath={openStaged}
      emptyText={vi.staging.noStaged}
      onopen={(change) => store.diff.open(change, { kind: 'staged' })}
      onprimary={(change) => void unstageFiles(store, [change])}
      onmenu={(event, change) => menus.openAt(event, fileMenu(store, change, { kind: 'staged' }))}
    />
  </div>

  <CommitComposer {store} />
</div>

<style>
  .wip {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 14px 14px 10px;
  }

  .glyph {
    color: var(--text-secondary);
  }

  .titles {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .timeline-btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .timeline-btn :global(svg) {
    color: var(--accent);
  }

  .timeline-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .branch {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section {
    display: flex;
    flex: 1 1 0;
    min-height: 90px;
  }

  .section.compact {
    flex: 0 0 auto;
    min-height: 0;
    max-height: 110px;
  }

  .section.conflicts {
    flex: 0 1 auto;
    max-height: 30%;
  }
</style>
