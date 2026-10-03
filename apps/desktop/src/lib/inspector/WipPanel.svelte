<!--
  Panel thay đổi chưa commit (port StagingView.swift): xung đột, chưa stage, đã stage — bấm file để xem diff ở vùng giữa,
  nút Stage / Bỏ stage / Huỷ khi rê chuột, nhấp đúp để stage / bỏ stage nhanh; ô soạn commit ở dưới.
-->
<script lang="ts">
  import { conflictAsChange, type FileChange } from '@thaigit/core';
  import { discardFiles, stageAll, stageFiles, unstageAll, unstageFiles } from '../actions/staging.ts';
  import { showBidi } from '../format/bidi.ts';
  import ChangeList from '../staging/ChangeList.svelte';
  import CommitComposer from '../staging/CommitComposer.svelte';
  import { vi } from '../strings.vi.ts';
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
  </header>

  {#if conflicts.length > 0}
    <div class="section conflicts">
      <ChangeList
        files={conflicts}
        title={vi.staging.conflictsTitle}
        selectedPath={null}
      />
    </div>
  {/if}

  <div class="section">
    <ChangeList
      files={status.unstaged}
      title={vi.staging.unstagedTitle}
      headerAction={{ title: vi.staging.stageAll, icon: 'stage', run: () => void stageAll(store) }}
      actions={[
        { icon: 'discard', title: vi.staging.discardFile, destructive: true, run: (change) => void discardFiles(store, [change]) },
        { icon: 'stage', title: vi.staging.stageFile, run: (change) => void stageFiles(store, [change]) },
      ]}
      selectedPath={openUnstaged}
      emptyText={vi.staging.noUnstaged}
      onopen={(change) => store.diff.open(change, { kind: 'unstaged' })}
      onprimary={(change) => void stageFiles(store, [change])}
    />
  </div>

  <div class="section">
    <ChangeList
      files={status.staged}
      title={vi.staging.stagedTitle}
      headerAction={{ title: vi.staging.unstageAll, icon: 'unstage', run: () => void unstageAll(store) }}
      actions={[{ icon: 'unstage', title: vi.staging.unstageFile, run: (change) => void unstageFiles(store, [change]) }]}
      selectedPath={openStaged}
      emptyText={vi.staging.noStaged}
      onopen={(change) => store.diff.open(change, { kind: 'staged' })}
      onprimary={(change) => void unstageFiles(store, [change])}
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
    flex-direction: column;
    min-width: 0;
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

  .section.conflicts {
    flex: 0 1 auto;
    max-height: 30%;
  }
</style>
