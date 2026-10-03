<!--
  Danh sách file thay đổi chưa commit có nút thao tác (port danh sách trong StagingView.swift): bấm file để xem diff ở vùng
  giữa, nhấp đúp để stage / bỏ stage, rê chuột hiện nút. Ảo hoá để repo có hàng nghìn file thay đổi vẫn mượt.
-->
<script lang="ts" module>
  import type { FileChange } from '@thaigit/core';
  import type { IconName } from '../ui/icons.ts';

  export interface RowAction {
    readonly icon: IconName;
    readonly title: string;
    readonly run: (change: FileChange) => void;
    readonly destructive?: boolean;
  }
</script>

<script lang="ts">
  import { fileChangeDirectory, fileChangeName } from '@thaigit/core';
  import { drag } from '../dnd/drag.svelte.ts';
  import { showBidi } from '../format/bidi.ts';
  import ChangeIcon from '../inspector/ChangeIcon.svelte';
  import Icon from '../ui/Icon.svelte';
  import VirtualList from '../ui/VirtualList.svelte';

  interface Props {
    files: readonly FileChange[];
    title: string;
    /** Nút ở tiêu đề (Stage tất cả / Bỏ stage tất cả). */
    headerAction?: { title: string; icon: IconName; run: () => void } | null;
    /** Nút hiện khi rê chuột vào hàng. */
    actions?: readonly RowAction[];
    /** Đường dẫn file đang mở diff (tô đậm hàng). */
    selectedPath?: string | null;
    emptyText?: string;
    onopen?: (change: FileChange) => void;
    /** Nhấp đúp (stage / bỏ stage nhanh). */
    onprimary?: (change: FileChange) => void;
    /** Chuột phải vào hàng. */
    onmenu?: (event: MouseEvent, change: FileChange) => void;
    /** Kéo file ra khỏi danh sách này (stage / bỏ stage bằng kéo-thả). */
    dragFrom?: 'unstaged' | 'staged';
    /** Danh sách này nhận file thả vào. */
    dropZone?: 'unstaged' | 'staged';
  }

  let {
    files,
    title,
    headerAction = null,
    actions = [],
    selectedPath = null,
    emptyText = '',
    onopen,
    onprimary,
    onmenu,
    dragFrom,
    dropZone,
  }: Props = $props();
</script>

<section class="changes" data-drop={dropZone ? `zone:${dropZone}` : undefined}>
  <header class="header">
    <span class="title">{title}</span>
    <span class="count">{files.length}</span>
    <span class="grow"></span>
    {#if headerAction && files.length > 0}
      <button type="button" class="header-action" onclick={headerAction.run}>
        <Icon name={headerAction.icon} size={14} />
        <span>{headerAction.title}</span>
      </button>
    {/if}
  </header>
  <div class="list">
    {#if files.length === 0}
      <p class="empty">{emptyText}</p>
    {:else}
      <VirtualList
        items={files}
        rowHeight={28}
        overscan={8}
        key={(change) => `${change.kind}:${change.path}`}
      >
        {#snippet row(change: FileChange)}
          <div
            class="file"
            class:selected={selectedPath === change.path}
            role="button"
            tabindex="0"
            title={showBidi(change.oldPath ? `${change.oldPath} → ${change.path}` : change.path)}
            onpointerdown={(event) => {
              const from = dragFrom;
              if (from)
                drag.begin(event, () => ({
                  kind: 'files',
                  from,
                  changes: [change],
                  label: fileChangeName(change),
                }));
            }}
            onclick={() => onopen?.(change)}
            ondblclick={() => onprimary?.(change)}
            oncontextmenu={(event) => onmenu?.(event, change)}
            onkeydown={(event) => {
              if (event.key === 'Enter') onopen?.(change);
              else if (event.key === ' ') {
                event.preventDefault();
                onprimary?.(change);
              }
            }}
          >
            <ChangeIcon kind={change.kind} />
            <span class="name"><bdi>{showBidi(fileChangeName(change))}</bdi></span>
            {#if fileChangeDirectory(change) !== ''}
              <span class="dir"><bdi>{showBidi(fileChangeDirectory(change))}</bdi></span>
            {/if}
            <span class="grow"></span>
            <span class="actions">
              {#each actions as action (action.title)}
                <button
                  type="button"
                  class="row-action"
                  class:destructive={action.destructive}
                  title={action.title}
                  aria-label={action.title}
                  onclick={(event) => {
                    event.stopPropagation();
                    action.run(change);
                  }}
                  ondblclick={(event) => event.stopPropagation()}
                >
                  <Icon name={action.icon} size={14} />
                </button>
              {/each}
            </span>
          </div>
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</section>

<style>
  .changes {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 7px 10px 7px 14px;
    border-top: 1px solid var(--separator);
    font-size: 12.5px;
  }

  .title {
    font-weight: 600;
  }

  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--chip-fill);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .grow {
    flex: 1;
  }

  .header-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .header-action:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .list {
    flex: 1;
    min-height: 0;
  }

  .empty {
    margin: 0;
    padding: 18px 14px;
    color: var(--text-tertiary);
    font-size: 12.5px;
    text-align: center;
  }

  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 8px 0 14px;
    font-size: 13px;
    white-space: nowrap;
    cursor: default;
  }

  .file:hover {
    background: var(--row-hover);
  }

  .file.selected {
    background: var(--row-selected-focus);
  }

  .file:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dir {
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 12px;
    text-overflow: ellipsis;
  }

  .actions {
    display: none;
    gap: 2px;
  }

  .file:hover .actions,
  .file:focus-within .actions,
  .file.selected .actions {
    display: inline-flex;
  }

  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .row-action:hover {
    background: var(--chip-fill);
    color: var(--text);
  }

  .row-action.destructive:hover {
    color: var(--danger);
  }
</style>
