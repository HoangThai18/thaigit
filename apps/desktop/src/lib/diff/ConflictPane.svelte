<!--
  Giải xung đột từng đoạn (port ConflictResolverView.swift): mỗi khối chọn Current / Incoming / cả hai (hoặc base, bỏ cả hai),
  xem trước kết quả, rồi "Lưu & đánh dấu đã giải quyết". Xung đột không giải từng đoạn được (xoá ở một phía, không phải
  UTF-8) thì chỉ có chọn cả file.
-->
<script lang="ts">
  import {
    conflictDescription,
    fileChangeDirectory,
    fileChangeName,
    type ConflictBlock,
    type ConflictResolution,
  } from '@thaigit/core';
  import { markResolved, resolveWhole, saveResolution } from '../actions/conflicts.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import { dialogs } from '../stores/dialogs.svelte.ts';
  import { menus, type MenuItem } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const diff = $derived(store.diff);
  const file = $derived(diff.file);
  const view = $derived(diff.state);
  const conflict = $derived(view.kind === 'conflict' ? view : null);
  const whole = $derived(view.kind === 'conflictWhole' ? view : null);
  const entry = $derived(conflict?.entry ?? whole?.entry ?? null);

  let choices = $state.raw<ReadonlyMap<number, ConflictResolution>>(new Map());
  let expanded = $state.raw<ReadonlySet<number>>(new Set());
  let choicesFor: unknown = null;

  // File mới (hoặc nạp lại sau khi đổi trên đĩa): bỏ các lựa chọn cũ.
  $effect.pre(() => {
    const current = conflict?.file ?? null;
    if (current === choicesFor) return;
    choicesFor = current;
    choices = new Map();
    expanded = new Set();
  });

  const total = $derived(conflict?.file.blocks.length ?? 0);
  const chosen = $derived(choices.size);

  function choose(block: ConflictBlock, resolution: ConflictResolution | null): void {
    const next = new Map(choices);
    if (resolution === null) next.delete(block.id);
    else next.set(block.id, resolution);
    choices = next;
  }

  function result(block: ConflictBlock, resolution: ConflictResolution): readonly string[] {
    switch (resolution) {
      case 'ours':
        return block.ours;
      case 'theirs':
        return block.theirs;
      case 'oursThenTheirs':
        return [...block.ours, ...block.theirs];
      case 'theirsThenOurs':
        return [...block.theirs, ...block.ours];
      case 'base':
        return block.base ?? [];
      case 'neither':
        return [];
    }
  }

  function moreMenu(event: MouseEvent, block: ConflictBlock): void {
    const current = choices.get(block.id);
    const items: MenuItem[] = [
      {
        title: vi.branches.keepBothIncomingFirst,
        checked: current === 'theirsThenOurs',
        run: () => choose(block, 'theirsThenOurs'),
      },
    ];
    if (block.base !== null) {
      items.push({
        title: vi.branches.keepBase,
        checked: current === 'base',
        run: () => choose(block, 'base'),
      });
    }
    items.push({
      title: vi.branches.keepNeither,
      checked: current === 'neither',
      run: () => choose(block, 'neither'),
    });
    if (current !== undefined) {
      items.push({ kind: 'separator' }, { title: vi.branches.clearChoice, run: () => choose(block, null) });
    }
    const target = event.currentTarget;
    if (target instanceof HTMLElement) menus.openBelow(target, items, { focusFirst: event.detail === 0 });
  }

  function save(): void {
    if (!conflict || chosen < total) return;
    void saveResolution(store, conflict.entry, conflict.file, conflict.sha256, choices);
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || menus.current !== null) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && conflict && chosen === total) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      diff.close();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#snippet code(lines: readonly string[], empty = '')}
  {#if lines.length === 0 && empty !== ''}
    <div class="code empty">{empty}</div>
  {:else}
    <div class="code">
      {#each lines as line, index (index)}<div class="code-line">{line === '' ? ' ' : line}</div>{/each}
    </div>
  {/if}
{/snippet}

{#if file}
  <section class="pane" aria-label={vi.branches.openConflict}>
    <header class="header">
      <button type="button" class="back" title={vi.staging.backTip} onclick={() => diff.close()}>
        <Icon name="chevron-left" size={15} />
        <span>{vi.staging.back}</span>
      </button>
      <div class="file">
        <strong class="name"><bdi>{showBidi(fileChangeName(file.change))}</bdi></strong>
        {#if fileChangeDirectory(file.change) !== ''}
          <span class="dir"><bdi>{showBidi(fileChangeDirectory(file.change))}</bdi></span>
        {/if}
      </div>
      <span class="badge">{vi.staging.conflictsTitle}</span>
    </header>

    {#if entry}
      <div class="banner">
        <span class="warn"><Icon name="warning" size={18} /></span>
        <div class="banner-text">
          <strong>{conflict ? vi.branches.conflictBlocks(total) : conflictDescription(entry.kind)}</strong>
          <span>{vi.branches.conflictLegend}</span>
        </div>
        <span class="grow"></span>
        <button type="button" class="button" onclick={() => void resolveWhole(store, entry, true)}>
          {vi.branches.useAllCurrent}
        </button>
        <button type="button" class="button" onclick={() => void resolveWhole(store, entry, false)}>
          {vi.branches.useAllIncoming}
        </button>
      </div>
    {/if}

    <div class="body">
      {#if view.kind === 'loading' || view.kind === 'idle'}
        <p class="message">{vi.staging.loading}</p>
      {:else if view.kind === 'failed'}
        <div class="message">
          <strong>{vi.staging.loadFailed}</strong>
          <p>{view.message}</p>
          <button type="button" class="button" onclick={() => void diff.load()}>{vi.staging.retry}</button>
        </div>
      {:else if whole}
        <div class="message">
          <p>
            {whole.reason === 'not-utf8'
              ? vi.branches.notUtf8
              : vi.branches.wholeFileOnly(conflictDescription(whole.entry.kind))}
          </p>
          <button type="button" class="button" onclick={() => void markResolved(store, [whole.entry.path])}>
            {vi.branches.markResolved}
          </button>
        </div>
      {:else if conflict}
        <div class="segments">
          {#each conflict.file.segments as segment, index (index)}
            {#if segment.kind === 'common'}
              {#if segment.lines.length <= 8 || expanded.has(index)}
                <div class="common">{@render code(segment.lines)}</div>
              {:else}
                <div class="common">
                  {@render code(segment.lines.slice(0, 3))}
                  <button
                    type="button"
                    class="link"
                    onclick={() => (expanded = new Set([...expanded, index]))}
                  >
                    {vi.branches.unchangedLines(segment.lines.length - 6)}
                  </button>
                  {@render code(segment.lines.slice(-3))}
                </div>
              {/if}
            {:else}
              {@const block = segment.block}
              {@const choice = choices.get(block.id)}
              <div class="block" class:done={choice !== undefined}>
                <div class="block-top">
                  <strong>{vi.branches.conflictNumber(block.id + 1, total)}</strong>
                  {#if choice !== undefined}
                    <span class="chosen"
                      ><Icon name="check-circle" size={13} /> {vi.branches.conflictChosen}</span
                    >
                  {/if}
                  <span class="grow"></span>
                  <button
                    type="button"
                    class="choice ours"
                    class:on={choice === 'ours'}
                    aria-pressed={choice === 'ours'}
                    onclick={() => choose(block, 'ours')}>{vi.branches.keepCurrent}</button
                  >
                  <button
                    type="button"
                    class="choice theirs"
                    class:on={choice === 'theirs'}
                    aria-pressed={choice === 'theirs'}
                    onclick={() => choose(block, 'theirs')}>{vi.branches.keepIncoming}</button
                  >
                  <button
                    type="button"
                    class="choice both"
                    class:on={choice === 'oursThenTheirs'}
                    aria-pressed={choice === 'oursThenTheirs'}
                    onclick={() => choose(block, 'oursThenTheirs')}>{vi.branches.keepBoth}</button
                  >
                  <button
                    type="button"
                    class="more"
                    title={vi.branches.moreChoices}
                    aria-label={vi.branches.moreChoices}
                    aria-haspopup="menu"
                    onclick={(event) => moreMenu(event, block)}
                  >
                    <Icon name="more" size={15} />
                  </button>
                </div>
                <div class="sides">
                  <button
                    type="button"
                    class="side ours"
                    class:highlighted={choice === 'ours' ||
                      choice === 'oursThenTheirs' ||
                      choice === 'theirsThenOurs'}
                    onclick={() => choose(block, 'ours')}
                  >
                    <span class="side-title"
                      >{vi.branches.current}
                      <span class="side-label"><bdi>{block.oursLabel}</bdi></span></span
                    >
                    {@render code(block.ours, ' ')}
                  </button>
                  <button
                    type="button"
                    class="side theirs"
                    class:highlighted={choice === 'theirs' ||
                      choice === 'oursThenTheirs' ||
                      choice === 'theirsThenOurs'}
                    onclick={() => choose(block, 'theirs')}
                  >
                    <span class="side-title"
                      >{vi.branches.incoming}
                      <span class="side-label"><bdi>{block.theirsLabel}</bdi></span></span
                    >
                    {@render code(block.theirs, ' ')}
                  </button>
                </div>
                {#if choice !== undefined}
                  <div class="result">
                    <span class="result-title">{vi.branches.result}</span>
                    {@render code(result(block, choice), vi.branches.resultEmpty)}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    {#if conflict}
      <footer class="footer">
        <span class="progress" aria-hidden="true"
          ><span class="fill" style:width="{total === 0 ? 0 : (chosen / total) * 100}%"></span></span
        >
        <span class="count">{vi.branches.chosenCount(chosen, total)}</span>
        <span class="grow"></span>
        <button type="button" class="button" disabled={chosen === 0} onclick={() => (choices = new Map())}>
          {vi.branches.resetChoices}
        </button>
        <button
          type="button"
          class="button primary"
          disabled={chosen < total}
          title="Ctrl/⌘ + Enter"
          onclick={save}
        >
          <Icon name="check-circle" size={14} />
          <span>{vi.branches.saveResolution}</span>
        </button>
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
    background: color-mix(in srgb, var(--warning) 22%, transparent);
    color: var(--text);
    font-size: 11px;
  }

  .banner {
    display: flex;
    align-items: center;
    flex: none;
    gap: 10px;
    margin: 10px 10px 0;
    padding: 9px 14px;
    border: 1px solid var(--glass-rim);
    border-radius: 14px;
    background: color-mix(in srgb, var(--brand-orange) 12%, var(--surface));
    font-size: 13px;
  }

  .warn {
    display: grid;
    color: var(--warning);
  }

  .banner-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .banner-text span {
    color: var(--text-secondary);
    font-size: 11.5px;
  }

  .grow {
    flex: 1;
  }

  .button {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .button.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .message {
    margin: 0;
    padding: 36px 24px;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: center;
  }

  .message p {
    max-width: 560px;
    margin: 8px auto 14px;
  }

  .segments {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }

  .code {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
    text-align: left;
  }

  .code.empty {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .common {
    color: var(--text-secondary);
  }

  .link {
    margin: 4px 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1.5px solid color-mix(in srgb, var(--warning) 60%, transparent);
    border-radius: 10px;
    background: var(--surface-muted);
  }

  .block.done {
    border-color: color-mix(in srgb, var(--success) 55%, transparent);
  }

  .block-top {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .chosen {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--success);
    font-size: 12px;
  }

  .choice {
    padding: 3px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .choice.on {
    border-color: transparent;
    color: #fff;
  }

  .choice.ours.on {
    background: var(--brand-blue);
  }

  .choice.theirs.on {
    background: #8e5bd8;
  }

  .choice.both.on {
    background: #1a9a8a;
  }

  .more {
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .more:hover {
    background: var(--row-hover);
  }

  .sides {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 8px;
    border: 1.5px solid transparent;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .side.ours {
    background: color-mix(in srgb, var(--brand-blue) 7%, var(--surface));
  }

  .side.theirs {
    background: color-mix(in srgb, #8e5bd8 7%, var(--surface));
  }

  .side.ours.highlighted {
    border-color: var(--brand-blue);
  }

  .side.theirs.highlighted {
    border-color: #8e5bd8;
  }

  .side-title {
    font-size: 11.5px;
    font-weight: 600;
  }

  .side-label {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--success) 8%, transparent);
  }

  .result-title {
    color: var(--text-secondary);
    font-size: 11.5px;
    font-weight: 600;
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 9px 14px;
    border-top: 1px solid var(--separator);
    background: var(--surface-muted);
    font-size: 12.5px;
  }

  .progress {
    width: 120px;
    height: 5px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--chip-fill);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--success);
  }

  .count {
    font-variant-numeric: tabular-nums;
  }
</style>
