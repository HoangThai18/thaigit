<!--
  Chỗ giữ cho panel WIP (stage/commit — phase 5). Hôm nay chỉ liệt kê CHỈ-ĐỌC các file chưa stage / đã stage / xung đột lấy từ
  `status`, để thấy đường dữ liệu hoạt động; chưa có nút stage, ô nhập message hay commit.
-->
<script lang="ts">
  import { conflictAsChange, type FileChange } from '@thaigit/core';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import FileList from './FileList.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const status = $derived(store.status);
  const conflicts = $derived<readonly FileChange[]>(status.conflicts.map((entry) => conflictAsChange(entry)));
  const clean = $derived(status.staged.length + status.unstaged.length + status.conflicts.length === 0);
</script>

<div class="wip">
  <div class="top">
    <h2>{vi.inspector.wipTitle}</h2>
    <p class="note">{vi.inspector.wipPlaceholder}</p>
  </div>
  {#if clean}
    <p class="clean">{vi.inspector.wipClean}</p>
  {:else}
    {#if conflicts.length > 0}
      <FileList files={conflicts} title={`${vi.inspector.wipConflicts} (${conflicts.length})`} />
    {/if}
    <FileList files={status.unstaged} title={`${vi.inspector.wipUnstaged} (${status.unstaged.length})`} />
    <FileList files={status.staged} title={`${vi.inspector.wipStaged} (${status.staged.length})`} />
  {/if}
</div>

<style>
  .wip {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    flex: none;
    padding: 14px 14px 8px;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 15px;
  }

  .note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .clean {
    margin: 14px;
    color: var(--text-secondary);
  }
</style>
