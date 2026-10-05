<!--
  Blame một file ở vùng giữa (thay graph): mỗi dòng kèm commit đã viết ra nó. Cột trái chỉ ghi sha · tác giả · thời gian ở
  dòng đầu của mỗi nhóm dòng liền nhau cùng commit; dải màu đậm hơn với commit mới hơn. Bấm cột trái để xem commit trên graph.
  Esc quay lại graph. Thân ảo hoá nên file hàng chục nghìn dòng vẫn mượt.
-->
<script lang="ts">
  import {
    fileChangeDirectory,
    fileChangeName,
    isUncommittedBlame,
    type BlameCommit,
    type BlameLine,
  } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { formatCommitTime } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import { dialogs } from '../stores/dialogs.svelte.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import VirtualList from '../ui/VirtualList.svelte';
  import { openFileHistory, showCommitInGraph } from './actions.ts';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const ROW_HEIGHT = 20;
  const TAB_WIDTH = 4;

  const blame = $derived(store.blame);
  const target = $derived(blame.target);
  const state = $derived(blame.state);
  const result = $derived(state.kind === 'ready' ? state.blame : null);
  const lines = $derived(result?.lines ?? []);
  const digits = $derived(String(Math.max(lines.length, 99)).length);
  const longest = $derived(
    lines.reduce((max, line) => Math.max(max, line.text.length + countTabs(line.text) * (TAB_WIDTH - 1)), 0),
  );
  /** Colour-strip intensity from how recent the commit is (0 = oldest, 1 = newest). */
  const recency = $derived.by<ReadonlyMap<string, number>>(() => {
    const commits = [...(result?.commits.values() ?? [])].filter((commit) => !isUncommittedBlame(commit.sha));
    commits.sort((a, b) => a.authorDate - b.authorDate);
    const span = Math.max(1, commits.length - 1);
    return new Map(commits.map((commit, index) => [commit.sha, commits.length === 1 ? 1 : index / span]));
  });

  function countTabs(text: string): number {
    let count = 0;
    for (const char of text) if (char === '\t') count++;
    return count;
  }

  function commitOf(line: BlameLine): BlameCommit | undefined {
    return result?.commits.get(line.sha);
  }

  function bandStrength(line: BlameLine): number {
    if (isUncommittedBlame(line.sha)) return 85;
    return Math.round(12 + (recency.get(line.sha) ?? 0) * 70);
  }

  function tooltip(line: BlameLine): string {
    if (isUncommittedBlame(line.sha)) return vi.history.uncommittedTip;
    const commit = commitOf(line);
    return showBidi(
      vi.history.lineTip(
        line.sha.slice(0, 7),
        commit?.authorName ?? '',
        commit ? formatCommitTime(commit.authorDate, { relative: false }) : '',
        commit?.summary ?? '',
      ),
    );
  }

  function openCommit(line: BlameLine): void {
    if (isUncommittedBlame(line.sha)) return;
    showCommitInGraph(store, line.sha);
  }

  function lineMenu(event: MouseEvent, line: BlameLine): void {
    if (isUncommittedBlame(line.sha)) return;
    menus.openAt(event, [
      { title: vi.history.showInGraph, icon: 'commit', run: () => openCommit(line) },
      { title: vi.branches.menuCopySha, icon: 'hash', run: () => void store.copy(line.sha, 'SHA') },
    ]);
  }

  function isTyping(eventTarget: EventTarget | null): boolean {
    return (
      eventTarget instanceof HTMLElement &&
      (eventTarget.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(eventTarget.tagName))
    );
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || dialogs.current !== null || menus.current !== null) return;
    if (event.key !== 'Escape' || isTyping(event.target)) return;
    blame.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if target}
  <section class="pane" aria-label={vi.history.blameLabel}>
    <header class="header">
      <button type="button" class="back" title={vi.staging.backTip} onclick={() => blame.close()}>
        <Icon name="chevron-left" size={15} />
        <span>{vi.staging.back}</span>
      </button>
      <span class="glyph"><Icon name="blame" size={15} /></span>
      <div class="file" title={showBidi(target.path)}>
        <strong class="name"><bdi>{showBidi(fileChangeName(target))}</bdi></strong>
        {#if fileChangeDirectory(target) !== ''}
          <span class="dir"><bdi>{showBidi(fileChangeDirectory(target))}</bdi></span>
        {/if}
      </div>
      <span class="badge">
        {target.rev === null ? vi.history.blameWorkingTree : vi.history.blameAtCommit(target.rev.slice(0, 7))}
      </span>
      <span class="grow"></span>
      <button type="button" class="action" onclick={() => openFileHistory(store, target.path)}>
        <Icon name="history" size={14} />
        <span>{vi.history.openHistory}</span>
      </button>
    </header>

    <div class="body">
      {#if state.kind === 'loading' || state.kind === 'idle'}
        <p class="message" role="status">{vi.history.blameLoading}</p>
      {:else if state.kind === 'failed'}
        <div class="message">
          <strong>{vi.history.blameFailed}</strong>
          <p class="detail">{state.message}</p>
          <button type="button" class="action" onclick={() => void blame.load()}
            >{vi.history.blameRetry}</button
          >
        </div>
      {:else if lines.length === 0}
        <p class="message">{vi.history.blameEmpty}</p>
      {:else}
        <div class="lines" style:--digits={digits} style:--tab={TAB_WIDTH}>
          <VirtualList
            items={lines}
            rowHeight={ROW_HEIGHT}
            overscan={20}
            minContentWidth={`calc(${longest + 2}ch + ${digits}ch + 284px)`}
            label={vi.history.blameLabel}
          >
            {#snippet row(line: BlameLine)}
              {@const commit = commitOf(line)}
              {@const uncommitted = isUncommittedBlame(line.sha)}
              <div class="line" class:group-start={line.startsGroup && line.number > 1}>
                <button
                  type="button"
                  class="gutter"
                  class:uncommitted
                  style:--band="{bandStrength(line)}%"
                  title={tooltip(line)}
                  tabindex={line.startsGroup ? 0 : -1}
                  disabled={uncommitted}
                  onclick={() => openCommit(line)}
                  oncontextmenu={(event) => lineMenu(event, line)}
                >
                  {#if line.startsGroup}
                    {#if uncommitted}
                      <span class="who">{vi.history.uncommitted}</span>
                    {:else}
                      <span class="sha">{line.sha.slice(0, 7)}</span>
                      <span class="who"><bdi>{showBidi(commit?.authorName ?? '')}</bdi></span>
                      <span class="when"
                        >{commit
                          ? formatCommitTime(commit.authorDate, { relative: prefs.value.relativeDates })
                          : ''}</span
                      >
                    {/if}
                  {/if}
                </button>
                <span class="num">{line.number}</span>
                <span class="text">{line.text}</span>
              </div>
            {/snippet}
          </VirtualList>
        </div>
      {/if}
    </div>
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

  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--text-secondary);
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

  .line {
    display: flex;
    align-items: stretch;
    height: 100%;
    white-space: pre;
    tab-size: var(--tab);
  }

  .line.group-start {
    box-shadow: inset 0 1px 0 var(--separator);
  }

  .gutter {
    position: sticky;
    left: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    flex: none;
    gap: 8px;
    box-sizing: border-box;
    width: 270px;
    padding: 0 8px 0 10px;
    border: 0;
    border-left: 3px solid color-mix(in srgb, var(--accent) var(--band), transparent);
    background: var(--surface-muted);
    color: var(--text-secondary);
    font: inherit;
    font-family: var(--font-ui);
    font-size: 11.5px;
    text-align: start;
    cursor: pointer;
  }

  .gutter:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--text);
  }

  .gutter:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .gutter.uncommitted {
    border-left-color: var(--warning);
    color: var(--warning);
    cursor: default;
  }

  .sha {
    flex: none;
    font-family: var(--font-mono);
  }

  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .when {
    flex: none;
    color: var(--text-tertiary);
  }

  .num {
    flex: none;
    align-self: center;
    box-sizing: content-box;
    width: calc(var(--digits) * 1ch);
    padding: 0 8px 0 6px;
    color: var(--text-tertiary);
    text-align: right;
    user-select: none;
  }

  .text {
    align-self: center;
    padding-right: 16px;
  }
</style>
