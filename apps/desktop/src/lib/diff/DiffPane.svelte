<!--
  Diff của một file ở vùng giữa, thay graph (port DiffPane.swift): tiêu đề có nút quay lại graph (Esc), tên file, nguồn diff,
  nút Stage / Bỏ stage / Huỷ cả file; thân diff ảo hoá (diff 20 000 dòng vẫn mượt). Với thay đổi chưa commit: nút Stage /
  Bỏ stage / Huỷ ở từng hunk, bấm vào dòng +/− để chọn rồi stage / bỏ stage / huỷ riêng những dòng đó.
-->
<script lang="ts">
  import { fileChangeDirectory, fileChangeName, type PresentationHunk, type PresentationLine } from '@thaigit/core';
  import { applyToSelection, discardFiles, stageFiles, unstageFiles, type PatchAction } from '../actions/staging.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import { dialogs } from '../stores/dialogs.svelte.ts';
  import { isWorkingTreeSource, type DiffSource } from '../stores/diff.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import VirtualList from '../ui/VirtualList.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  type Row =
    | { readonly kind: 'hunk'; readonly hunk: PresentationHunk }
    | { readonly kind: 'line'; readonly hunkId: number; readonly line: PresentationLine };

  const ROW_HEIGHT = 20;

  const diff = $derived(store.diff);
  const file = $derived(diff.file);
  const state = $derived(diff.state);
  const presentation = $derived(state.kind === 'text' ? state.presentation : null);
  const rows = $derived.by<readonly Row[]>(() => {
    if (!presentation) return [];
    const result: Row[] = [];
    for (const hunk of presentation.hunks) {
      result.push({ kind: 'hunk', hunk });
      for (const line of hunk.lines) result.push({ kind: 'line', hunkId: hunk.id, line });
    }
    return result;
  });
  const digits = $derived(String(Math.max(presentation?.maxLineNumber ?? 0, 99)).length);
  const minWidth = $derived(
    presentation ? `calc(${presentation.maxLineLength + 2}ch + ${digits * 2}ch + 48px)` : undefined,
  );
  const workingTree = $derived(file !== null && isWorkingTreeSource(file.source));
  const unstaged = $derived(file?.source.kind === 'unstaged');
  /** Bấm chọn được từng dòng (thay đổi chưa commit, file thường). */
  const pickable = $derived(workingTree && diff.supportsPartial);
  const selected = $derived(diff.selectedCount);

  function sourceLabel(source: DiffSource): string {
    switch (source.kind) {
      case 'unstaged':
        return vi.staging.sourceUnstaged;
      case 'staged':
        return vi.staging.sourceStaged;
      case 'commit':
        return vi.staging.sourceCommit(source.sha.slice(0, 7));
      case 'stash':
        return vi.staging.sourceStash;
      case 'conflict':
        return vi.staging.conflictsTitle;
    }
  }

  function apply(action: PatchAction, hunkId?: number): void {
    void applyToSelection(store, action, hunkId === undefined ? {} : { hunkId });
  }

  function marker(line: PresentationLine): string {
    return line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' ';
  }

  function isChange(line: PresentationLine): boolean {
    return line.kind === 'addition' || line.kind === 'deletion';
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || dialogs.current !== null) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    if (selected > 0) diff.clearSelection();
    else diff.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#snippet lineText(line: PresentationLine)}
  {#if line.highlight}
    {line.text.slice(0, line.highlight.start)}<mark>{line.text.slice(line.highlight.start, line.highlight.end)}</mark
    >{line.text.slice(line.highlight.end)}
  {:else}
    {line.text}
  {/if}
{/snippet}

{#snippet lineBody(line: PresentationLine)}
  <span class="num">{line.oldNumber ?? ''}</span>
  <span class="num">{line.newNumber ?? ''}</span>
  <span class="marker">{marker(line)}</span>
  <span class="text">{@render lineText(line)}</span>
{/snippet}

{#if file}
  <section class="pane" aria-label={vi.staging.diffLabel}>
    <header class="header">
      <button type="button" class="back" title={vi.staging.backTip} onclick={() => diff.close()}>
        <Icon name="chevron-left" size={15} />
        <span>{vi.staging.back}</span>
      </button>
      <div class="file" title={showBidi(file.change.oldPath ? `${file.change.oldPath} → ${file.change.path}` : file.change.path)}>
        <strong class="name"><bdi>{showBidi(fileChangeName(file.change))}</bdi></strong>
        {#if fileChangeDirectory(file.change) !== ''}
          <span class="dir"><bdi>{showBidi(fileChangeDirectory(file.change))}</bdi></span>
        {/if}
      </div>
      <span class="badge">{sourceLabel(file.source)}</span>
      {#if presentation}
        <span class="stats"><span class="add">+{presentation.diff.additions}</span> <span class="del">−{presentation.diff.deletions}</span></span>
      {/if}
      <span class="grow"></span>
      {#if unstaged}
        <button type="button" class="action destructive" onclick={() => void discardFiles(store, [file.change])}>
          <Icon name="discard" size={14} />
          <span>{vi.staging.discardFile}</span>
        </button>
        <button type="button" class="action primary" onclick={() => void stageFiles(store, [file.change])}>
          <Icon name="stage" size={14} />
          <span>{vi.staging.stageFile}</span>
        </button>
      {:else if file.source.kind === 'staged'}
        <button type="button" class="action" onclick={() => void unstageFiles(store, [file.change])}>
          <Icon name="unstage" size={14} />
          <span>{vi.staging.unstageFile}</span>
        </button>
      {/if}
    </header>

    <div class="body">
      {#if state.kind === 'loading' || state.kind === 'idle'}
        <p class="message">{vi.staging.loading}</p>
      {:else if state.kind === 'binary'}
        <p class="message">{vi.staging.binary}</p>
      {:else if state.kind === 'empty'}
        <p class="message">{vi.staging.empty}</p>
      {:else if state.kind === 'failed'}
        <div class="message">
          <strong>{vi.staging.loadFailed}</strong>
          <p class="detail">{state.message}</p>
          <button type="button" class="action" onclick={() => void diff.load()}>{vi.staging.retry}</button>
        </div>
      {:else if state.kind === 'tooLarge'}
        <div class="message">
          <strong>{vi.staging.tooLargeTitle}</strong>
          <p class="detail">
            {vi.staging.tooLargeMessage(
              state.diff.additions + state.diff.deletions,
              state.diff.additions,
              state.diff.deletions,
            )}
          </p>
          <button type="button" class="action" onclick={() => diff.showAnyway()}>{vi.staging.showAnyway}</button>
        </div>
      {:else}
        <div class="lines" style:--digits={digits}>
          <VirtualList
            items={rows}
            rowHeight={ROW_HEIGHT}
            overscan={20}
            minContentWidth={minWidth}
            key={(row) => (row.kind === 'hunk' ? `h${row.hunk.id}` : `${row.hunkId}:${row.line.index}`)}
            label={vi.staging.diffLabel}
          >
            {#snippet row(row: Row)}
              {#if row.kind === 'hunk'}
                <div class="hunk">
                  <span class="hunk-header"><bdi>{row.hunk.header}</bdi></span>
                  {#if pickable}
                    <span class="hunk-actions">
                      {#if unstaged}
                        <button type="button" class="mini destructive" onclick={() => apply('discard', row.hunk.id)}>
                          {vi.staging.discardHunk}
                        </button>
                        <button type="button" class="mini" onclick={() => apply('stage', row.hunk.id)}>
                          {vi.staging.stageHunk}
                        </button>
                      {:else}
                        <button type="button" class="mini" onclick={() => apply('unstage', row.hunk.id)}>
                          {vi.staging.unstageHunk}
                        </button>
                      {/if}
                    </span>
                  {/if}
                </div>
              {:else if pickable && isChange(row.line)}
                {@const checked = diff.isSelected(row.hunkId, row.line.index)}
                <div
                  class="line pick {row.line.kind}"
                  class:selected={checked}
                  role="checkbox"
                  aria-checked={checked}
                  tabindex="0"
                  title={vi.staging.lineTip}
                  onclick={() => diff.toggleLine(row.hunkId, row.line.index)}
                  onkeydown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault();
                      diff.toggleLine(row.hunkId, row.line.index);
                    }
                  }}
                >
                  {@render lineBody(row.line)}
                </div>
              {:else}
                <div class="line {row.line.kind}">
                  {@render lineBody(row.line)}
                </div>
              {/if}
            {/snippet}
          </VirtualList>
        </div>
      {/if}
    </div>

    {#if selected > 0 && pickable}
      <footer class="selection" role="status">
        <span>{vi.staging.selectedLines(selected)}</span>
        <span class="grow"></span>
        <button type="button" class="action" onclick={() => diff.clearSelection()}>{vi.staging.clearSelection}</button>
        {#if unstaged}
          <button type="button" class="action destructive" onclick={() => apply('discard')}>
            <Icon name="discard" size={14} />
            <span>{vi.staging.discardLines}</span>
          </button>
          <button type="button" class="action primary" onclick={() => apply('stage')}>
            <Icon name="stage" size={14} />
            <span>{vi.staging.stageLines}</span>
          </button>
        {:else}
          <button type="button" class="action primary" onclick={() => apply('unstage')}>
            <Icon name="unstage" size={14} />
            <span>{vi.staging.unstageLines}</span>
          </button>
        {/if}
      </footer>
    {/if}
  </section>
{/if}

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--surface);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-width: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--separator);
    font-size: 13px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 3px;
    padding: 4px 9px 4px 5px;
    border: 1px solid var(--glass-rim);
    border-radius: 14px;
    background: var(--glass-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .back:hover {
    background: var(--row-hover);
  }

  .file {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
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

  .badge {
    flex: none;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .stats {
    flex: none;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .add {
    color: var(--success);
  }

  .del {
    color: var(--danger);
  }

  .grow {
    flex: 1;
  }

  .action {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .action:hover {
    background: var(--row-hover);
  }

  .action.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .action.destructive {
    color: var(--danger);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .message {
    margin: 0;
    padding: 40px 24px;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: center;
  }

  .message .detail {
    margin: 8px auto 14px;
    max-width: 520px;
    overflow-wrap: anywhere;
  }

  .lines {
    height: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .hunk,
  .line {
    display: flex;
    align-items: center;
    height: 100%;
    white-space: pre;
  }

  .hunk {
    gap: 10px;
    padding-left: 12px;
    background: var(--surface-muted);
    color: var(--text-tertiary);
  }

  .hunk-header {
    position: sticky;
    left: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hunk-actions {
    position: sticky;
    right: 8px;
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
    padding-right: 8px;
    font-family: var(--font-ui);
  }

  .mini {
    padding: 0 8px;
    height: 17px;
    border: 1px solid var(--field-border);
    border-radius: 5px;
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .mini:hover {
    background: var(--row-hover);
  }

  .mini.destructive {
    color: var(--danger);
  }

  .num {
    flex: none;
    box-sizing: content-box;
    width: calc(var(--digits) * 1ch);
    padding: 0 6px;
    color: var(--text-tertiary);
    text-align: right;
    user-select: none;
  }

  .marker {
    flex: none;
    width: 1.5ch;
    padding-left: 4px;
    color: var(--text-tertiary);
    user-select: none;
  }

  .text {
    padding-right: 16px;
  }

  .line.addition {
    background: color-mix(in srgb, var(--success) 13%, transparent);
  }

  .line.deletion {
    background: color-mix(in srgb, var(--danger) 13%, transparent);
  }

  .line.addition .marker {
    color: var(--success);
  }

  .line.deletion .marker {
    color: var(--danger);
  }

  .line.noNewline {
    color: var(--text-tertiary);
    font-style: italic;
  }

  mark {
    border-radius: 2px;
    color: inherit;
  }

  .line.addition mark {
    background: color-mix(in srgb, var(--success) 35%, transparent);
  }

  .line.deletion mark {
    background: color-mix(in srgb, var(--danger) 35%, transparent);
  }

  .line.pick {
    cursor: pointer;
  }

  .line.pick:hover {
    box-shadow: inset 3px 0 0 var(--text-tertiary);
  }

  .line.pick.selected {
    box-shadow: inset 3px 0 0 var(--accent);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .line.pick:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .selection {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 8px 12px;
    border-top: 1px solid var(--separator);
    background: var(--surface-muted);
    font-size: 12.5px;
  }
</style>
