<!--
  Diff của một file ở vùng giữa, thay graph (port DiffPane.swift): tiêu đề có nút quay lại graph (Esc), tên file, nguồn diff,
  nút Stage / Bỏ stage / Huỷ cả file; thân diff ảo hoá (diff 20 000 dòng vẫn mượt). Với thay đổi chưa commit: nút Stage /
  Bỏ stage / Huỷ ở từng hunk, bấm vào dòng +/− để chọn rồi stage / bỏ stage / huỷ riêng những dòng đó.
  Hai bố cục: gộp (một cột) và tách đôi (cũ | mới, chọn dòng như nhau); file ảnh xem bản cũ / mới cạnh nhau.
-->
<script lang="ts">
  import {
    fileChangeDirectory,
    fileChangeName,
    type PresentationHunk,
    type PresentationLine,
  } from '@thaigit/core';
  import { prefs } from '../stores/prefs.svelte.ts';
  import ImageDiff from './ImageDiff.svelte';
  import { languageFor, lineSegments, tokenizeLine } from './syntax.ts';
  import {
    applyToSelection,
    discardFiles,
    stageFiles,
    unstageFiles,
    type PatchAction,
  } from '../actions/staging.ts';
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
    | { readonly kind: 'line'; readonly hunkId: number; readonly line: PresentationLine }
    | {
        readonly kind: 'split';
        readonly hunkId: number;
        readonly key: number;
        readonly left: PresentationLine | null;
        readonly right: PresentationLine | null;
      };

  const ROW_HEIGHT = 20;

  const diff = $derived(store.diff);
  const file = $derived(diff.file);
  const state = $derived(diff.state);
  const presentation = $derived(state.kind === 'text' ? state.presentation : null);
  const split = $derived(prefs.value.diffLayout === 'split');
  const ignoreWhitespace = $derived(prefs.value.diffIgnoreWhitespace);
  /** Ngôn ngữ để tô màu cú pháp (theo đuôi file); `null` = không tô. */
  const language = $derived(file ? languageFor(file.change.path) : null);

  function toggleWhitespace(): void {
    prefs.update({ diffIgnoreWhitespace: !ignoreWhitespace });
    diff.clearSelection();
    void diff.load();
  }
  const rows = $derived.by<readonly Row[]>(() => {
    if (!presentation) return [];
    const result: Row[] = [];
    for (const hunk of presentation.hunks) {
      result.push({ kind: 'hunk', hunk });
      if (split) {
        hunk.splitRows.forEach((row, key) =>
          result.push({ kind: 'split', hunkId: hunk.id, key, left: row.left, right: row.right }),
        );
      } else {
        for (const line of hunk.lines) result.push({ kind: 'line', hunkId: hunk.id, line });
      }
    }
    return result;
  });
  const digits = $derived(String(Math.max(presentation?.maxLineNumber ?? 0, 99)).length);
  const minWidth = $derived(
    presentation && !split ? `calc(${presentation.maxLineLength + 2}ch + ${digits * 2}ch + 48px)` : undefined,
  );
  const workingTree = $derived(file !== null && isWorkingTreeSource(file.source));
  const unstaged = $derived(file?.source.kind === 'unstaged');
  /** Bấm chọn được từng dòng (thay đổi chưa commit, file thường). */
  const pickable = $derived(workingTree && diff.supportsPartial);
  const selected = $derived(diff.selectedCount);
  // Không dùng `$state` được (biến `state` ở trên che mất rune); chỉ đọc trong hàm xử lý phím nên không cần phản ứng.
  const list: { current?: VirtualList<Row> } = {};
  /** Hàng đầu tiên đang thấy: nhảy tới hunk trước / sau tính từ chỗ đang đọc. */
  let firstVisible = 0;
  const hunkRows = $derived(rows.flatMap((row, index) => (row.kind === 'hunk' ? [index] : [])));
  const siblings = $derived(diff.siblings);
  const filePosition = $derived(
    file && siblings ? siblings.findIndex((change) => change.path === file.change.path) + 1 : 0,
  );

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

  function jumpHunk(direction: 1 | -1): void {
    let target: number | undefined;
    for (const index of hunkRows) {
      if (direction === 1 && index > firstVisible) {
        target = index;
        break;
      }
      if (direction === -1 && index < firstVisible) target = index;
    }
    if (target !== undefined) list.current?.scrollToIndex(target, 'top');
  }

  function isTyping(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    );
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || isTyping(event.target)) return;
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (event.shiftKey) diff.step(direction);
      else jumpHunk(direction);
      return;
    }
    if (event.key !== 'Escape') return;
    if (selected > 0) diff.clearSelection();
    else diff.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#snippet lineText(line: PresentationLine)}
  {#each lineSegments(tokenizeLine(line.text, language), line.highlight) as segment, index (index)}
    {#if segment.marked}<mark class={segment.type ? `tok tok-${segment.type}` : undefined}
        >{segment.text}</mark
      >{:else if segment.type}<span class="tok tok-{segment.type}">{segment.text}</span
      >{:else}{segment.text}{/if}
  {/each}
{/snippet}

{#snippet lineBody(line: PresentationLine)}
  <span class="num">{line.oldNumber ?? ''}</span>
  <span class="num">{line.newNumber ?? ''}</span>
  <span class="marker">{marker(line)}</span>
  <span class="text">{@render lineText(line)}</span>
{/snippet}

{#snippet half(hunkId: number, line: PresentationLine | null, side: 'left' | 'right')}
  {#if line === null}
    <div class="half filler"></div>
  {:else if pickable && isChange(line)}
    {@const checked = diff.isSelected(hunkId, line.index)}
    <div
      class="half line pick {line.kind}"
      class:selected={checked}
      role="checkbox"
      aria-checked={checked}
      tabindex="0"
      title={vi.staging.lineTip}
      onclick={() => diff.toggleLine(hunkId, line.index)}
      onkeydown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          diff.toggleLine(hunkId, line.index);
        }
      }}
    >
      <span class="num">{(side === 'left' ? line.oldNumber : line.newNumber) ?? ''}</span>
      <span class="marker">{marker(line)}</span>
      <span class="text">{@render lineText(line)}</span>
    </div>
  {:else}
    <div class="half line {line.kind}">
      <span class="num">{(side === 'left' ? line.oldNumber : line.newNumber) ?? ''}</span>
      <span class="marker">{marker(line)}</span>
      <span class="text">{@render lineText(line)}</span>
    </div>
  {/if}
{/snippet}

{#if file}
  <section class="pane" aria-label={vi.staging.diffLabel}>
    <header class="header">
      <button type="button" class="back" title={vi.staging.backTip} onclick={() => diff.close()}>
        <Icon name="chevron-left" size={15} />
        <span>{vi.staging.back}</span>
      </button>
      <div
        class="file"
        title={showBidi(
          file.change.oldPath ? `${file.change.oldPath} → ${file.change.path}` : file.change.path,
        )}
      >
        <strong class="name"><bdi>{showBidi(fileChangeName(file.change))}</bdi></strong>
        {#if fileChangeDirectory(file.change) !== ''}
          <span class="dir"><bdi>{showBidi(fileChangeDirectory(file.change))}</bdi></span>
        {/if}
      </div>
      <span class="badge">{sourceLabel(file.source)}</span>
      {#if presentation}
        <span class="stats"
          ><span class="add">+{presentation.diff.additions}</span>
          <span class="del">−{presentation.diff.deletions}</span></span
        >
      {/if}
      <span class="grow"></span>
      {#if siblings && siblings.length > 1 && filePosition > 0}
        <div class="nav" role="group" aria-label={vi.staging.navLabel} title={vi.staging.navLabel}>
          <button
            type="button"
            title={vi.staging.previousFile}
            aria-label={vi.staging.previousFile}
            disabled={filePosition <= 1}
            onclick={() => diff.step(-1)}
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <span class="position">{vi.staging.filePosition(filePosition, siblings.length)}</span>
          <button
            type="button"
            title={vi.staging.nextFile}
            aria-label={vi.staging.nextFile}
            disabled={filePosition >= siblings.length}
            onclick={() => diff.step(1)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
        </div>
      {/if}
      {#if presentation}
        <div class="layout" role="group" aria-label={vi.staging.layoutLabel}>
          <button
            type="button"
            class:active={!split}
            aria-pressed={!split}
            onclick={() => prefs.update({ diffLayout: 'unified' })}>{vi.staging.layoutUnified}</button
          >
          <button
            type="button"
            class:active={split}
            aria-pressed={split}
            onclick={() => prefs.update({ diffLayout: 'split' })}>{vi.staging.layoutSplit}</button
          >
        </div>
      {/if}
      {#if file.change.kind !== 'untracked' && state.kind !== 'binary'}
        <div class="layout">
          <button
            type="button"
            class:active={ignoreWhitespace}
            aria-pressed={ignoreWhitespace}
            title={vi.staging.ignoreWhitespaceTip}
            onclick={toggleWhitespace}>{vi.staging.ignoreWhitespace}</button
          >
        </div>
      {/if}
      {#if unstaged}
        <button
          type="button"
          class="action destructive"
          onclick={() => void discardFiles(store, [file.change])}
        >
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
        <ImageDiff {store} {file} />
      {:else if state.kind === 'empty'}
        <p class="message">{ignoreWhitespace ? vi.staging.emptyWhitespace : vi.staging.empty}</p>
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
          <button type="button" class="action" onclick={() => diff.showAnyway()}
            >{vi.staging.showAnyway}</button
          >
        </div>
      {:else}
        <div class="lines" style:--digits={digits}>
          <VirtualList
            bind:this={list.current}
            items={rows}
            rowHeight={ROW_HEIGHT}
            overscan={20}
            minContentWidth={minWidth}
            key={(row) =>
              row.kind === 'hunk'
                ? `h${row.hunk.id}`
                : row.kind === 'split'
                  ? `${row.hunkId}:s${row.key}`
                  : `${row.hunkId}:${row.line.index}`}
            label={vi.staging.diffLabel}
            onrange={(range) => (firstVisible = range.start)}
          >
            {#snippet row(row: Row)}
              {#if row.kind === 'hunk'}
                <div class="hunk">
                  <span class="hunk-header"><bdi>{row.hunk.header}</bdi></span>
                  {#if pickable}
                    <span class="hunk-actions">
                      {#if unstaged}
                        <button
                          type="button"
                          class="mini destructive"
                          onclick={() => apply('discard', row.hunk.id)}
                        >
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
              {:else if row.kind === 'split'}
                <div class="split-row">
                  {@render half(row.hunkId, row.left, 'left')}
                  {@render half(row.hunkId, row.right, 'right')}
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
        <button type="button" class="action" onclick={() => diff.clearSelection()}
          >{vi.staging.clearSelection}</button
        >
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

  .nav {
    display: inline-flex;
    align-items: center;
    flex: none;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }

  .nav button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .nav button:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--text);
  }

  .nav button:disabled {
    color: var(--text-tertiary);
    cursor: default;
  }

  .position {
    min-width: 28px;
    color: var(--text-secondary);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    text-align: center;
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

  /* Tô màu cú pháp (loại token của Prism / refractor); màu ở theme/tokens.css cho cả sáng lẫn tối. */
  .tok-comment,
  .tok-prolog,
  .tok-doctype,
  .tok-cdata {
    color: var(--syn-comment);
    font-style: italic;
  }

  .tok-keyword,
  .tok-important,
  .tok-atrule,
  .tok-rule,
  .tok-selector {
    color: var(--syn-keyword);
  }

  .tok-string,
  .tok-char,
  .tok-template-string,
  .tok-attr-value,
  .tok-regex,
  .tok-url {
    color: var(--syn-string);
  }

  .tok-number,
  .tok-boolean,
  .tok-constant,
  .tok-symbol,
  .tok-unit {
    color: var(--syn-number);
  }

  .tok-function,
  .tok-function-variable,
  .tok-method {
    color: var(--syn-function);
  }

  .tok-class-name,
  .tok-builtin,
  .tok-type,
  .tok-namespace,
  .tok-tag {
    color: var(--syn-type);
  }

  .tok-property,
  .tok-attr-name,
  .tok-key,
  .tok-variable,
  .tok-parameter {
    color: var(--syn-property);
  }

  .tok-operator,
  .tok-punctuation {
    color: var(--syn-punctuation);
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

  .layout {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    overflow: hidden;
  }

  .layout button {
    padding: 3px 9px;
    border: none;
    background: var(--field-fill);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .layout button + button {
    border-left: 1px solid var(--field-border);
  }

  .layout button.active {
    background: var(--chip-fill);
    color: var(--text);
    font-weight: 600;
  }

  .split-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    height: 100%;
  }

  .half {
    min-width: 0;
    overflow: hidden;
  }

  .half + .half {
    border-left: 1px solid var(--separator);
  }

  .half .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .half.filler {
    background: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      color-mix(in srgb, var(--separator) 60%, transparent) 6px 7px
    );
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
