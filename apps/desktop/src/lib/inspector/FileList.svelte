<!-- Danh sách file thay đổi (commit/stash), ảo hoá để commit hàng nghìn file vẫn mượt. Bấm file để xem diff ở vùng giữa. -->
<script lang="ts">
  import { fileChangeDirectory, fileChangeName, type FileChange } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import VirtualList from '../ui/VirtualList.svelte';
  import ChangeIcon from './ChangeIcon.svelte';
  import { summarizeChanges } from './changes.ts';

  interface Props {
    files: readonly FileChange[];
    title: string;
    emptyText?: string;
    /** Bấm / Enter vào file (mở diff). */
    onopen?: (change: FileChange) => void;
    /** Đường dẫn file đang mở diff (tô hàng). */
    selectedPath?: string | null;
  }

  let { files, title, emptyText = '', onopen, selectedPath = null }: Props = $props();

  const summary = $derived(summarizeChanges(files));
</script>

<div class="files">
  <div class="header">
    <span class="title">{title}</span>
    <span class="summary">
      {#if summary.added > 0}<span class="add">＋ {summary.added}</span>{/if}
      {#if summary.modified > 0}<span class="mod">✎ {summary.modified}</span>{/if}
      {#if summary.deleted > 0}<span class="del">− {summary.deleted}</span>{/if}
    </span>
  </div>
  <div class="list">
    {#if files.length === 0 && emptyText}
      <p class="empty">{emptyText}</p>
    {:else}
      <VirtualList
        items={files}
        rowHeight={26}
        overscan={8}
        key={(change) => `${change.kind}:${change.path}`}
      >
        {#snippet row(change: FileChange)}
          <div
            class="file"
            class:openable={onopen !== undefined}
            class:selected={selectedPath === change.path}
            role="button"
            tabindex={onopen ? 0 : -1}
            title={showBidi(change.oldPath ? `${change.oldPath} → ${change.path}` : change.path)}
            onclick={() => onopen?.(change)}
            onkeydown={(event) => {
              if (onopen && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onopen(change);
              }
            }}
          >
            <ChangeIcon kind={change.kind} />
            <span class="name selectable"><bdi>{showBidi(fileChangeName(change))}</bdi></span>
            {#if fileChangeDirectory(change) !== ''}
              <span class="dir selectable"><bdi>{showBidi(fileChangeDirectory(change))}</bdi></span>
            {/if}
          </div>
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</div>

<style>
  .files {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 0;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 7px 14px;
    font-size: 12.5px;
  }

  .title {
    font-weight: 600;
  }

  .summary {
    display: inline-flex;
    gap: 9px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .summary span {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .add {
    color: var(--success);
  }
  .mod {
    color: var(--warning);
  }
  .del {
    color: var(--danger);
  }

  .list {
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--separator);
  }

  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 14px;
    font-size: 13px;
    white-space: nowrap;
  }

  .file:hover {
    background: var(--row-hover);
  }

  .file.selected {
    background: var(--row-selected-focus);
  }

  .file.openable:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dir {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Cắt phần đầu đường dẫn (giữ thư mục gần file nhất), như `truncationMode(.head)`. */
    direction: rtl;
    text-align: left;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .empty {
    margin: 14px;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
