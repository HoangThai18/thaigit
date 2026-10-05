<!--
  Giải xung đột như GitKraken (port ConflictResolverView.swift): mỗi khối chọn Current / Incoming / cả hai (hoặc base, bỏ
  cả hai) hoặc tick từng dòng; khung Kết quả xem trước cả file và sửa tay được trước khi lưu; nút / phím Alt + ↑ / ↓ nhảy
  giữa các đoạn. Xung đột không giải từng đoạn được (xoá ở một phía, không phải UTF-8) thì chỉ có chọn cả file.
-->
<script lang="ts">
  import {
    conflictLineSets,
    fileChangeDirectory,
    fileChangeName,
    parseConflictFile,
    previewConflicts,
    resolveConflicts,
    toggleConflictLine,
    type ConflictBlock,
    type ConflictChoice,
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

  let choices = $state.raw<ReadonlyMap<number, ConflictChoice>>(new Map());
  let expanded = $state.raw<ReadonlySet<number>>(new Set());
  /** Đoạn đang đứng (nhảy trước / sau). */
  let current = $state(0);
  /** Nội dung khung Kết quả khi người dùng sửa tay (null: theo các lựa chọn). */
  let edited = $state<string | null>(null);
  let segmentsElement = $state<HTMLElement | null>(null);
  let choicesFor: unknown = null;

  // File mới (hoặc nạp lại sau khi đổi trên đĩa): bỏ các lựa chọn cũ.
  $effect.pre(() => {
    const opened = conflict?.file ?? null;
    if (opened === choicesFor) return;
    choicesFor = opened;
    choices = new Map();
    expanded = new Set();
    current = 0;
    edited = null;
  });

  const total = $derived(conflict?.file.blocks.length ?? 0);
  const chosen = $derived(choices.size);
  const decoder = new TextDecoder();
  const preview = $derived(conflict ? decoder.decode(previewConflicts(conflict.file, choices)) : '');
  const canSave = $derived(conflict !== null && (edited !== null || chosen === total));

  function choose(block: ConflictBlock, choice: ConflictChoice | null): void {
    const next = new Map(choices);
    if (choice === null) next.delete(block.id);
    else next.set(block.id, choice);
    choices = next;
    edited = null;
    current = block.id;
    // Vừa chọn cả một phía: tự sang đoạn chưa chọn kế tiếp (như GitKraken).
    if (choice !== null && typeof choice === 'string') {
      const following = conflict?.file.blocks.find(
        (candidate) => candidate.id > block.id && !next.has(candidate.id),
      );
      if (following) jumpTo(following.id);
    }
  }

  function toggleLine(block: ConflictBlock, side: 'ours' | 'theirs', line: number): void {
    choose(block, toggleConflictLine(choices.get(block.id), block, side, line));
  }

  function jumpTo(id: number): void {
    current = Math.max(0, Math.min(id, total - 1));
    queueMicrotask(() => {
      segmentsElement
        ?.querySelector(`[data-block="${current}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function fillRemaining(resolution: ConflictResolution): void {
    if (!conflict) return;
    const next = new Map(choices);
    for (const block of conflict.file.blocks) if (!next.has(block.id)) next.set(block.id, resolution);
    choices = next;
    edited = null;
  }

  function isSide(choice: ConflictChoice | undefined, resolution: ConflictResolution): boolean {
    return choice === resolution;
  }

  function moreMenu(event: MouseEvent, block: ConflictBlock): void {
    const selected = choices.get(block.id);
    const items: MenuItem[] = [
      {
        title: vi.branches.keepBothIncomingFirst,
        checked: selected === 'theirsThenOurs',
        run: () => choose(block, 'theirsThenOurs'),
      },
    ];
    if (block.base !== null) {
      items.push({
        title: vi.branches.keepBase,
        checked: selected === 'base',
        run: () => choose(block, 'base'),
      });
    }
    items.push({
      title: vi.branches.keepNeither,
      checked: selected === 'neither',
      run: () => choose(block, 'neither'),
    });
    if (selected !== undefined) {
      items.push({ kind: 'separator' }, { title: vi.branches.clearChoice, run: () => choose(block, null) });
    }
    const target = event.currentTarget;
    if (target instanceof HTMLElement) menus.openBelow(target, items, { focusFirst: event.detail === 0 });
  }

  function quickMenu(event: MouseEvent): void {
    if (!entry) return;
    const target = event.currentTarget;
    const opened = entry;
    const items: MenuItem[] = [
      { title: vi.branches.useAllCurrent, run: () => void resolveWhole(store, opened, true) },
      { title: vi.branches.useAllIncoming, run: () => void resolveWhole(store, opened, false) },
    ];
    if (conflict) {
      items.push(
        { kind: 'separator' },
        { title: vi.branches.fillCurrent, run: () => fillRemaining('ours') },
        { title: vi.branches.fillIncoming, run: () => fillRemaining('theirs') },
        { title: vi.branches.fillBoth, run: () => fillRemaining('oursThenTheirs') },
      );
    }
    if (target instanceof HTMLElement) menus.openBelow(target, items, { focusFirst: event.detail === 0 });
  }

  async function save(): Promise<void> {
    if (!conflict || !canSave) return;
    let content: Uint8Array | null;
    if (edited !== null) {
      const bytes = new TextEncoder().encode(edited);
      const parsed = parseConflictFile(bytes);
      if (parsed.ok && parsed.file.blocks.length > 0) {
        const ok = await dialogs.confirm({
          title: vi.branches.markersLeftTitle,
          message: vi.branches.markersLeftMessage,
          confirmTitle: vi.branches.saveAnyway,
        });
        if (!ok) return;
      }
      content = bytes;
    } else {
      content = resolveConflicts(conflict.file, choices);
    }
    if (content === null) return;
    void saveResolution(store, conflict.entry, conflict.sha256, content);
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || menus.current !== null) return;
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) {
      event.preventDefault();
      void save();
    } else if (
      event.altKey &&
      !typing &&
      conflict &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      jumpTo(current + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Escape') {
      if (typing) return;
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

{#snippet side(block: ConflictBlock, which: 'ours' | 'theirs', picked: ReadonlySet<number>)}
  {@const lines = which === 'ours' ? block.ours : block.theirs}
  {@const title = which === 'ours' ? vi.branches.current : vi.branches.incoming}
  <div class="side {which}" class:highlighted={picked.size > 0}>
    <button
      type="button"
      class="side-title"
      title={vi.branches.keepWholeSide(title)}
      ondblclick={() => choose(block, which)}
    >
      {title}
      <span class="side-label"><bdi>{which === 'ours' ? block.oursLabel : block.theirsLabel}</bdi></span>
    </button>
    {#if lines.length === 0}
      <div class="code empty">{vi.branches.resultEmpty}</div>
    {:else}
      <div class="lines">
        {#each lines as line, index (index)}
          <button
            type="button"
            class="line"
            class:on={picked.has(index)}
            aria-pressed={picked.has(index)}
            onclick={() => toggleLine(block, which, index)}
          >
            <span class="tick"><Icon name={picked.has(index) ? 'check' : 'stop'} size={10} /></span>
            <span class="code-line">{line === '' ? ' ' : line}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
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
          <strong
            >{conflict ? vi.branches.conflictBlocks(total) : vi.branches.conflictKinds[entry.kind]}</strong
          >
          <span>{vi.branches.conflictLegend} {conflict ? vi.branches.conflictLineHint : ''}</span>
        </div>
        <span class="grow"></span>
        {#if conflict}
          <span class="nav">
            <button
              type="button"
              class="nav-button"
              title={vi.branches.prevConflict}
              aria-label={vi.branches.prevConflict}
              disabled={current <= 0}
              onclick={() => jumpTo(current - 1)}><Icon name="chevron-up" size={14} /></button
            >
            <span class="nav-count">{vi.branches.conflictPosition(Math.min(current + 1, total), total)}</span>
            <button
              type="button"
              class="nav-button"
              title={vi.branches.nextConflict}
              aria-label={vi.branches.nextConflict}
              disabled={current >= total - 1}
              onclick={() => jumpTo(current + 1)}><Icon name="chevron-down" size={14} /></button
            >
          </span>
        {/if}
        <button type="button" class="button" aria-haspopup="menu" onclick={quickMenu}>
          <Icon name="sparkles" size={14} />
          <span>{vi.branches.quickPick}</span>
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
    {/if}

    <div class="body" class:split={conflict !== null}>
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
              : vi.branches.wholeFileOnly(vi.branches.conflictKinds[whole.entry.kind])}
          </p>
          <button type="button" class="button" onclick={() => void markResolved(store, [whole.entry.path])}>
            {vi.branches.markResolved}
          </button>
        </div>
      {:else if conflict}
        <div class="segments" bind:this={segmentsElement}>
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
              {@const picked = conflictLineSets(choice, block)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div
                class="block"
                class:done={choice !== undefined}
                class:current={block.id === current}
                data-block={block.id}
                onclick={() => (current = block.id)}
              >
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
                    class:on={isSide(choice, 'ours')}
                    aria-pressed={isSide(choice, 'ours')}
                    onclick={() => choose(block, 'ours')}>{vi.branches.keepCurrent}</button
                  >
                  <button
                    type="button"
                    class="choice theirs"
                    class:on={isSide(choice, 'theirs')}
                    aria-pressed={isSide(choice, 'theirs')}
                    onclick={() => choose(block, 'theirs')}>{vi.branches.keepIncoming}</button
                  >
                  <button
                    type="button"
                    class="choice both"
                    class:on={isSide(choice, 'oursThenTheirs')}
                    aria-pressed={isSide(choice, 'oursThenTheirs')}
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
                  {@render side(block, 'ours', picked.ours)}
                  {@render side(block, 'theirs', picked.theirs)}
                </div>
              </div>
            {/if}
          {/each}
        </div>
        <div class="output">
          <div class="output-top">
            <strong>{vi.branches.result}</strong>
            {#if edited === null && chosen < total}
              <span class="left">{vi.branches.outputLeft(total - chosen)}</span>
            {/if}
            <span class="grow"></span>
            <button
              type="button"
              class="button small"
              class:on={edited !== null}
              aria-pressed={edited !== null}
              title={vi.branches.editOutputTip}
              onclick={() => (edited = edited === null ? preview : null)}
            >
              <Icon name="pencil" size={12} />
              <span>{vi.branches.editOutput}</span>
            </button>
          </div>
          {#if edited !== null}
            <textarea class="output-text" spellcheck="false" bind:value={edited}></textarea>
          {:else}
            <pre class="output-text">{preview}</pre>
          {/if}
        </div>
      {/if}
    </div>

    {#if conflict}
      <footer class="footer">
        <span class="progress" aria-hidden="true"
          ><span class="fill" style:width="{total === 0 ? 0 : (chosen / total) * 100}%"></span></span
        >
        <span class="count"
          >{edited !== null ? vi.branches.editingOutput : vi.branches.chosenCount(chosen, total)}</span
        >
        <span class="grow"></span>
        <button
          type="button"
          class="button"
          disabled={chosen === 0 && edited === null}
          onclick={() => {
            choices = new Map();
            edited = null;
          }}
        >
          {vi.branches.resetChoices}
        </button>
        <button
          type="button"
          class="button primary"
          disabled={!canSave}
          title="Ctrl/⌘ + Enter"
          onclick={() => void save()}
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

  .body.split {
    display: grid;
    grid-template-rows: minmax(160px, 1fr) minmax(120px, 34%);
    overflow: hidden;
  }

  .body.split .segments {
    overflow: auto;
  }

  .block.current {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }

  .nav-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  .nav-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .nav-count {
    min-width: 34px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .side-title {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: default;
  }

  .lines {
    display: flex;
    flex-direction: column;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 1px 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    white-space: pre;
    cursor: pointer;
  }

  .line:hover {
    background: var(--row-hover);
  }

  .tick {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 13px;
    height: 13px;
    border: 1px solid var(--field-border);
    border-radius: 3px;
    color: transparent;
  }

  .side.ours .line.on {
    background: color-mix(in srgb, var(--brand-blue) 16%, transparent);
  }

  .side.theirs .line.on {
    background: color-mix(in srgb, #8e5bd8 16%, transparent);
  }

  .side.ours .line.on .tick {
    border-color: var(--brand-blue);
    background: var(--brand-blue);
    color: #fff;
  }

  .side.theirs .line.on .tick {
    border-color: #8e5bd8;
    background: #8e5bd8;
    color: #fff;
  }

  .output {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--separator);
    background: color-mix(in srgb, var(--success) 5%, var(--surface));
  }

  .output-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    font-size: 12.5px;
  }

  .left {
    color: var(--warning);
    font-size: 12px;
  }

  .button.small {
    padding: 3px 9px;
    font-size: 12px;
  }

  .button.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .output-text {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 8px 14px;
    overflow: auto;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    resize: none;
    outline: none;
  }
</style>
