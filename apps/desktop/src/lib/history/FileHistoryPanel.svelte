<!--
  Panel Lịch sử file (thay chi tiết ở bên phải khi mở): các commit đụng tới file, mới nhất trên cùng, theo dấu qua các lần
  đổi tên. Bấm một commit để xem thay đổi của file đó ở vùng giữa; chuột phải để xem trên graph hoặc blame tại commit đó.
-->
<script lang="ts">
  import { fileChangeDirectory, fileChangeName, shortSha, type FileHistoryEntry } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { formatCommitTime } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import { openBlame, showCommitInGraph } from './actions.ts';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const history = $derived(store.fileHistory);
  const path = $derived(history.path ?? '');
  /** The commit on screen: the open diff if there is one, otherwise the commit being blamed. */
  const openSha = $derived(
    store.diff.file?.source.kind === 'commit'
      ? store.diff.file.source.sha
      : (store.blame.target?.rev ?? null),
  );

  function note(entry: FileHistoryEntry): string | null {
    const change = entry.change;
    if (change.kind === 'renamed' && change.oldPath !== undefined)
      return vi.history.renamedFrom(change.oldPath);
    if (change.kind === 'deleted') return vi.history.deleted;
    if (change.kind === 'added') return vi.history.added;
    return null;
  }

  function entryMenu(event: MouseEvent, entry: FileHistoryEntry): void {
    menus.openAt(event, [
      { title: vi.history.openDiff, icon: 'compare', run: () => history.select(entry) },
      { title: vi.history.showInGraph, icon: 'commit', run: () => showCommitInGraph(store, entry.commit.id) },
      {
        title: vi.history.blameHere,
        icon: 'blame',
        disabled: entry.change.kind === 'deleted',
        run: () => openBlame(store, entry.change.path, entry.commit.id),
      },
      { kind: 'separator' },
      { title: vi.branches.menuCopySha, icon: 'hash', run: () => void store.copy(entry.commit.id, 'SHA') },
    ]);
  }
</script>

<div class="history" role="region" aria-label={vi.history.title}>
  <header class="top">
    <span class="glyph"><Icon name="history" size={18} /></span>
    <div class="titles">
      <h2>{vi.history.title}</h2>
      <span class="path" title={showBidi(path)}>
        <bdi>{showBidi(fileChangeName({ path }))}</bdi>
        {#if fileChangeDirectory({ path }) !== ''}
          <span class="dir"><bdi>{showBidi(fileChangeDirectory({ path }))}</bdi></span>
        {/if}
      </span>
    </div>
    <button
      type="button"
      class="icon-btn"
      title={vi.history.close}
      aria-label={vi.history.close}
      onclick={() => history.close()}
    >
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="entries" role="listbox" aria-label={vi.history.title}>
    {#if history.entries.length === 0}
      <p class="empty" role="status">
        {history.loading ? vi.history.loading : history.failed ? vi.history.loadFailed : vi.history.empty}
      </p>
    {:else}
      <!-- Khoá theo vị trí: dữ liệu repo không bảo đảm duy nhất. -->
      {#each history.entries as entry, index (index)}
        {@const extra = note(entry)}
        <button
          type="button"
          class="entry"
          class:selected={openSha === entry.commit.id}
          role="option"
          aria-selected={openSha === entry.commit.id}
          onclick={() => history.select(entry)}
          oncontextmenu={(event) => entryMenu(event, entry)}
        >
          <span class="subject"><bdi>{showBidi(entry.commit.subject)}</bdi></span>
          <span class="meta">
            <span class="sha">{shortSha(entry.commit)}</span>
            <span><bdi>{showBidi(entry.commit.authorName)}</bdi></span>
            <span>{formatCommitTime(entry.commit.authorDate, { relative: prefs.value.relativeDates })}</span>
          </span>
          {#if extra !== null}
            <span class="note"><bdi>{showBidi(extra)}</bdi></span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <footer>
    <span class="count">
      {history.limited
        ? vi.history.limited(history.entries.length)
        : vi.history.commits(history.entries.length)}
    </span>
    <button type="button" class="action" onclick={() => openBlame(store, path, null)}>
      <Icon name="blame" size={13} />
      <span>{vi.history.blameCurrent}</span>
    </button>
  </footer>
</div>

<style>
  .history {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex: none;
    padding: 14px 14px 8px;
  }

  .glyph {
    padding-top: 1px;
    color: var(--text-secondary);
  }

  .titles {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .path {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dir {
    margin-left: 6px;
    color: var(--text-tertiary);
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

  .entries {
    flex: 1 1 0;
    min-height: 0;
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

  .subject {
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: 8px;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .sha {
    font-family: var(--font-mono);
  }

  .note {
    color: var(--text-tertiary);
    font-size: 11.5px;
    font-style: italic;
  }

  .empty {
    margin: 0;
    padding: 16px 6px;
    color: var(--text-secondary);
    font-size: 12.5px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 8px 14px 10px;
    border-top: 1px solid var(--separator);
  }

  .count {
    flex: 1;
    color: var(--text-secondary);
    font-size: 11.5px;
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

  .action:hover {
    background: var(--row-hover);
  }

  .action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
