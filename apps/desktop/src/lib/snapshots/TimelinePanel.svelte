<!--
  Panel Dòng thời gian (thay chi tiết ở bên phải khi mở): danh sách mốc tự lưu, chọn một mốc để thấy file khác với bây giờ —
  bấm file để xem diff ở vùng giữa, chuột phải để khôi phục riêng file đó, hoặc khôi phục tất cả (luôn hỏi trước, có Hoàn tác).
-->
<script lang="ts">
  import type { FileChange, SnapshotEntry } from '@thaigit/core';
  import { formatCommitTime } from '../format/time.ts';
  import FileList from '../inspector/FileList.svelte';
  import { vi } from '../strings.vi.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const timeline = $derived(store.timeline);
  const comparison = $derived(timeline.comparison);
  const openPath = $derived(store.diff.file?.source.kind === 'commit' ? store.diff.file.change.path : null);

  function reasonLabel(entry: SnapshotEntry): string {
    if (entry.reason === 'before-restore') return vi.snapshots.reasonBeforeRestore;
    if (entry.reason === 'manual') return vi.snapshots.reasonManual;
    return vi.snapshots.reasonAuto;
  }

  function fileMenu(event: MouseEvent, change: FileChange): void {
    menus.openAt(event, [
      { title: vi.snapshots.restoreFile, icon: 'undo', run: () => void timeline.restore([change.path]) },
    ]);
  }
</script>

<div class="timeline" role="region" aria-label={vi.snapshots.title}>
  <header class="top">
    <span class="glyph"><Icon name="clock" size={18} /></span>
    <h2>{vi.snapshots.title}</h2>
    <button
      type="button"
      class="icon-btn"
      title={vi.snapshots.takeNow}
      aria-label={vi.snapshots.takeNow}
      onclick={() => void timeline.takeNow()}
    >
      <Icon name="plus" size={14} />
    </button>
    <button
      type="button"
      class="icon-btn"
      title={vi.snapshots.close}
      aria-label={vi.snapshots.close}
      onclick={() => timeline.close()}
    >
      <Icon name="x" size={14} />
    </button>
  </header>

  {#if !prefs.value.snapshotsEnabled}
    <p class="notice">{vi.snapshots.disabledGlobally}</p>
  {:else if timeline.disabledForRepo}
    <p class="notice">
      {vi.snapshots.disabledForRepo}
      <button type="button" class="link" onclick={() => timeline.setEnabledForRepo(true)}>
        {vi.snapshots.enableForRepo}
      </button>
    </p>
  {:else}
    <p class="intro">{vi.snapshots.intro}</p>
  {/if}

  <div class="entries" role="listbox" aria-label={vi.snapshots.title}>
    {#if timeline.entries.length === 0}
      <p class="empty">{timeline.loading ? vi.snapshots.loading : vi.snapshots.empty}</p>
    {:else}
      <!-- Khoá theo vị trí: hai mục reflog có thể trỏ cùng một commit. -->
      {#each timeline.entries as entry, index (index)}
        <button
          type="button"
          class="entry"
          class:selected={timeline.selected?.index === entry.index && timeline.selected?.sha === entry.sha}
          role="option"
          aria-selected={timeline.selected?.index === entry.index && timeline.selected?.sha === entry.sha}
          onclick={() => void timeline.select(entry)}
        >
          <span class="time">{formatCommitTime(entry.time, { relative: prefs.value.relativeDates })}</span>
          <span class="meta">
            {entry.files === null
              ? reasonLabel(entry)
              : `${reasonLabel(entry)} · ${vi.snapshots.filesVsHead(entry.files)}`}
          </span>
        </button>
      {/each}
    {/if}
  </div>

  {#if timeline.selected !== null}
    <div class="compare">
      {#if timeline.comparing && comparison === null}
        <p class="empty" role="status">{vi.snapshots.comparing}</p>
      {:else if comparison !== null}
        {#if comparison.files.length === 0}
          <p class="empty">{vi.snapshots.noDifference}</p>
        {:else}
          <div class="files">
            <FileList
              files={comparison.files}
              title={vi.snapshots.compareTitle}
              selectedPath={openPath}
              onopen={(change) => timeline.openFile(change)}
              onmenu={fileMenu}
            />
          </div>
          <div class="actions">
            {#if openPath !== null}
              <button type="button" class="action" onclick={() => void timeline.restore([openPath])}>
                <Icon name="undo" size={13} />
                <span>{vi.snapshots.restoreFile}</span>
              </button>
            {/if}
            <button type="button" class="action primary" onclick={() => void timeline.restore(null)}>
              <Icon name="reset" size={13} />
              <span>{vi.snapshots.restoreAll}</span>
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if prefs.value.snapshotsEnabled && !timeline.disabledForRepo}
    <footer>
      <button type="button" class="link" onclick={() => timeline.setEnabledForRepo(false)}>
        {vi.snapshots.disableForRepo}
      </button>
    </footer>
  {/if}
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 14px 14px 6px;
  }

  .glyph {
    color: var(--text-secondary);
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text-secondary);
  }

  .icon-btn:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .intro,
  .notice {
    flex: none;
    margin: 0 14px 8px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.4;
  }

  .notice {
    color: var(--warning);
  }

  .entries {
    flex: 1 1 0;
    min-height: 80px;
    overflow-y: auto;
    padding: 0 8px;
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
  }

  .entry:hover {
    background: var(--row-hover);
  }

  .entry.selected {
    background: var(--row-selected-focus);
  }

  .entry:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .time {
    font-size: 13px;
    font-weight: 500;
  }

  .meta {
    color: var(--text-secondary);
    font-size: 11.5px;
  }

  .compare {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 120px;
    border-top: 1px solid var(--separator);
  }

  .files {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 14px;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .action.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .action:focus-visible,
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .empty {
    margin: 0;
    padding: 16px 14px;
    color: var(--text-secondary);
    font-size: 12.5px;
  }

  footer {
    flex: none;
    padding: 6px 14px 10px;
    border-top: 1px solid var(--separator);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
  }
</style>
