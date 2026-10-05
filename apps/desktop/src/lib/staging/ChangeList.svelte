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
  import { prefs } from '../stores/prefs.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import VirtualList from '../ui/VirtualList.svelte';
  import { fileTreeRows, type FileTreeRow } from './fileTree.ts';

  interface Props {
    files: readonly FileChange[];
    title: string;
    /** Button in the header (Stage all / Unstage all). */
    headerAction?: { title: string; icon: IconName; run: (event: MouseEvent) => void; tip?: string } | null;
    /** Button shown while hovering a row. */
    actions?: readonly RowAction[];
    /** Path of the file whose diff is open (row shown in bold). */
    selectedPath?: string | null;
    emptyText?: string;
    onopen?: (change: FileChange, event?: MouseEvent) => void;
    /** Currently selected paths, to handle several files at once (row background). */
    markedPaths?: ReadonlySet<string>;
    /** Secondary text next to the file name (e.g. "2 hunks" for a conflict). */
    badges?: ReadonlyMap<string, string>;
    /** Double-click (quick stage / unstage). */
    onprimary?: (change: FileChange) => void;
    /** Right-click on a row. */
    onmenu?: (event: MouseEvent, change: FileChange) => void;
    /** Drag a file out of this list (stage / unstage by drag and drop). */
    dragFrom?: 'unstaged' | 'staged';
    /** This list accepts dropped files. */
    dropZone?: 'unstaged' | 'staged';
    /** Tree layout: the button on a folder row (Stage / Unstage the whole folder). */
    folderAction?: { title: string; icon: IconName; run: (changes: readonly FileChange[]) => void } | null;
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
    folderAction = null,
    markedPaths,
    badges,
  }: Props = $props();

  /** Path / Tree switch like GitKraken (a setting shared by every file list). */
  const tree = $derived(prefs.value.fileListTree);
  let collapsed = $state<ReadonlySet<string>>(new Set());
  const rows = $derived<readonly FileTreeRow[]>(
    tree ? fileTreeRows(files, collapsed) : files.map((change) => ({ kind: 'file', change, depth: 0 })),
  );

  function toggleFolder(path: string): void {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }
</script>

<section class="changes" data-drop={dropZone ? `zone:${dropZone}` : undefined}>
  <header class="header">
    <span class="title">{title}</span>
    <span class="count">{files.length}</span>
    <span class="grow"></span>
    <button
      type="button"
      class="header-action icon-only"
      title={tree ? vi.staging.listAsPaths : vi.staging.listAsTree}
      aria-label={tree ? vi.staging.listAsPaths : vi.staging.listAsTree}
      aria-pressed={tree}
      onclick={() => prefs.update({ fileListTree: !tree })}
    >
      <Icon name={tree ? 'list' : 'folder'} size={14} />
    </button>
    {#if headerAction && files.length > 0}
      <button type="button" class="header-action" title={headerAction.tip} onclick={headerAction.run}>
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
        items={rows}
        rowHeight={28}
        overscan={8}
        key={(item) =>
          item.kind === 'folder' ? `dir:${item.path}` : `${item.change.kind}:${item.change.path}`}
      >
        {#snippet row(item: FileTreeRow)}
          {#if item.kind === 'folder'}
            <div
              class="file folder"
              role="button"
              tabindex="0"
              aria-expanded={!collapsed.has(item.path)}
              style:padding-left="{14 + item.depth * 14}px"
              onclick={() => toggleFolder(item.path)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleFolder(item.path);
                }
              }}
            >
              <Icon name={collapsed.has(item.path) ? 'chevron-right' : 'chevron-down'} size={11} />
              <Icon name="folder" size={14} />
              <span class="name"><bdi>{showBidi(item.name)}</bdi></span>
              <span class="dir">{item.count}</span>
              <span class="grow"></span>
              {#if folderAction}
                {@const action = folderAction}
                <span class="actions">
                  <button
                    type="button"
                    class="row-action"
                    title={action.title}
                    aria-label={action.title}
                    onclick={(event) => {
                      event.stopPropagation();
                      action.run(files.filter((change) => change.path.startsWith(`${item.path}/`)));
                    }}
                  >
                    <Icon name={action.icon} size={14} />
                  </button>
                </span>
              {/if}
            </div>
          {:else}
            {@render fileRow(item.change, item.depth)}
          {/if}
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</section>

{#snippet fileRow(change: FileChange, depth: number)}
  <div
    class="file"
    class:selected={selectedPath === change.path}
    class:marked={markedPaths?.has(change.path) ?? false}
    style:padding-left={tree ? `${28 + depth * 14}px` : undefined}
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
    onclick={(event) => onopen?.(change, event)}
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
    {#if !tree && fileChangeDirectory(change) !== ''}
      <span class="dir"><bdi>{showBidi(fileChangeDirectory(change))}</bdi></span>
    {/if}
    {#if badges?.has(change.path)}
      <span class="badge">{badges.get(change.path)}</span>
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

  .header-action.icon-only {
    padding: 2px 5px;
  }

  .header-action[aria-pressed='true'] {
    color: var(--accent);
  }

  .folder :global(svg) {
    flex: none;
    color: var(--text-secondary);
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

  .file.marked {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warning) 22%, transparent);
    color: var(--text-secondary);
    font-size: 11px;
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
