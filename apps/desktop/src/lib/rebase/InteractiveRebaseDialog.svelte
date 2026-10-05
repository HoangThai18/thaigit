<!--
  Hộp thoại rebase tương tác (như GitKraken): các commit sau commit gốc, mới nhất trên cùng. Mỗi hàng chọn một việc (Giữ /
  Reword / Squash / Fixup / Drop), kéo tay nắm hoặc Alt + ↑ / ↓ để đổi thứ tự; reword mở ô soạn message mới ngay trong hàng.
  Phím tắt trên hàng: P / R / S / F / D. Esc = Huỷ (không bấm nền để huỷ — tránh mất kế hoạch đang soạn).
-->
<script lang="ts">
  import { REBASE_ACTIONS, shortSha, type RebaseAction } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import { rebaseProblemText, runInteractiveRebase } from './actions.ts';
  import { rebaseEditor, type RebaseSession } from './rebaseEditor.svelte.ts';

  interface Props {
    store: RepoStore;
    session: RebaseSession;
  }

  let { store, session }: Props = $props();

  const rows = $derived(session.rows);
  const problem = $derived(session.problem);
  let list = $state<HTMLElement | null>(null);
  /** Hàng đang kéo và chỗ sẽ thả (chỉ số hiển thị). */
  let dragFrom = $state<number | null>(null);
  let dragTo = $state<number | null>(null);
  /** Hàng đang được focus (cho `aria-selected`). */
  let focused = $state(0);

  const ACTION_KEYS: Readonly<Record<string, RebaseAction>> = {
    p: 'pick',
    r: 'reword',
    s: 'squash',
    f: 'fixup',
    d: 'drop',
  };

  function actionTitle(action: RebaseAction): string {
    switch (action) {
      case 'pick':
        return vi.rebase.actionPick;
      case 'reword':
        return vi.rebase.actionReword;
      case 'squash':
        return vi.rebase.actionSquash;
      case 'fixup':
        return vi.rebase.actionFixup;
      case 'drop':
        return vi.rebase.actionDrop;
    }
  }

  function rowElements(): HTMLElement[] {
    return list ? [...list.querySelectorAll<HTMLElement>(':scope > .row')] : [];
  }

  function focusRow(index: number): void {
    queueMicrotask(() => rowElements()[index]?.focus());
  }

  function moveBy(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    session.move(index, target);
    focusRow(target);
  }

  function isTyping(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  }

  function onrowkeydown(event: KeyboardEvent, index: number): void {
    if (isTyping(event.target)) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveBy(index, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1))));
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = ACTION_KEYS[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      session.setAction(index, action);
    }
  }

  function targetIndex(clientY: number): number {
    const elements = rowElements();
    for (const [index, element] of elements.entries()) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return Math.max(0, elements.length - 1);
  }

  function onhandledown(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragFrom = index;
    dragTo = index;
  }

  function onhandlemove(event: PointerEvent): void {
    if (dragFrom === null) return;
    dragTo = targetIndex(event.clientY);
  }

  function onhandleup(): void {
    if (dragFrom !== null && dragTo !== null && dragFrom !== dragTo) {
      session.move(dragFrom, dragTo);
      focusRow(dragTo);
    }
    dragFrom = null;
    dragTo = null;
  }

  function start(): void {
    if (problem !== null) return;
    void runInteractiveRebase(store, session);
  }

  function ondialogkeydown(event: KeyboardEvent): void {
    // Phím trong hộp không lan ra cửa sổ (Esc không đóng diff phía sau, phím tắt repo không chạy).
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      rebaseEditor.close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      start();
    }
  }

  $effect(() => {
    focusRow(0);
  });
</script>

<div class="backdrop" role="presentation">
  <div
    class="dialog glass"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rebase-title"
    aria-describedby="rebase-subtitle"
    tabindex="-1"
    onkeydown={ondialogkeydown}
  >
    <header>
      <span class="glyph"><Icon name="rebase" size={18} /></span>
      <div class="titles">
        <h2 id="rebase-title"><bdi>{showBidi(vi.rebase.title(session.branch))}</bdi></h2>
        <p id="rebase-subtitle" class="subtitle">
          <bdi>{showBidi(vi.rebase.subtitle(rows.length, shortSha(session.base), session.base.subject))}</bdi>
        </p>
      </div>
    </header>

    <div class="rows" role="listbox" aria-label={vi.rebase.listLabel} bind:this={list}>
      <!-- Khoá theo vị trí (quy tắc của repo: dữ liệu repo không bảo đảm duy nhất). -->
      {#each rows as step, index (index)}
        {@const sha = shortSha(step.commit)}
        <div
          class="row {step.action}"
          class:drop-before={dragTo === index && dragFrom !== null && dragFrom > index}
          class:drop-after={dragTo === index && dragFrom !== null && dragFrom < index}
          class:dragging={dragFrom === index}
          role="option"
          aria-selected={focused === index}
          tabindex="0"
          onfocus={() => (focused = index)}
          onkeydown={(event) => onrowkeydown(event, index)}
        >
          <div class="line">
            <button
              type="button"
              class="handle"
              title={vi.rebase.dragHandle}
              aria-label={vi.rebase.dragHandle}
              tabindex="-1"
              onpointerdown={(event) => onhandledown(event, index)}
              onpointermove={onhandlemove}
              onpointerup={onhandleup}
              onpointercancel={onhandleup}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <select
              class="action"
              aria-label={vi.rebase.actionLabel(sha)}
              value={step.action}
              onchange={(event) => session.setAction(index, event.currentTarget.value as RebaseAction)}
            >
              {#each REBASE_ACTIONS as action (action)}
                <option value={action}>{actionTitle(action)}</option>
              {/each}
            </select>
            <span class="sha">{sha}</span>
            <span class="subject" title={showBidi(step.commit.subject)}>
              <bdi>{showBidi(step.commit.subject)}</bdi>
            </span>
            {#if step.action === 'squash' || step.action === 'fixup'}
              <span class="note">↓ {vi.rebase.squashInto}</span>
            {/if}
            <span class="moves">
              <button
                type="button"
                title={vi.rebase.moveUp}
                aria-label={vi.rebase.moveUp}
                disabled={index === 0}
                onclick={() => moveBy(index, -1)}
              >
                <Icon name="chevron-up" size={12} />
              </button>
              <button
                type="button"
                title={vi.rebase.moveDown}
                aria-label={vi.rebase.moveDown}
                disabled={index === rows.length - 1}
                onclick={() => moveBy(index, 1)}
              >
                <Icon name="chevron-down" size={12} />
              </button>
            </span>
          </div>
          {#if step.action === 'reword'}
            <textarea
              class="message"
              rows="3"
              aria-label={vi.rebase.messageLabel(sha)}
              placeholder={step.message === undefined ? vi.rebase.messageLoading : ''}
              value={step.message ?? ''}
              spellcheck="false"
              oninput={(event) => session.setMessage(index, event.currentTarget.value)}></textarea>
          {/if}
        </div>
      {/each}
    </div>

    <p class="keys">{vi.rebase.keysHint}</p>
    {#if problem !== null}
      <p class="problem" class:quiet={problem === 'unchanged'} role="status">{rebaseProblemText(problem)}</p>
    {/if}

    <div class="buttons">
      <button type="button" class="button" onclick={() => session.reset()}>{vi.rebase.reset}</button>
      <span class="grow"></span>
      <button type="button" class="button" onclick={() => rebaseEditor.close()}>{vi.rebase.cancel}</button>
      <button type="button" class="button primary" disabled={problem !== null} onclick={start}>
        {vi.rebase.start}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100vw - 48px));
    max-height: calc(100vh - 64px);
    padding: 18px 20px 14px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex: none;
  }

  .glyph {
    padding-top: 1px;
    color: var(--text-secondary);
  }

  .titles {
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .subtitle {
    margin: 4px 0 12px;
    color: var(--text-secondary);
    font-size: 12.5px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--separator);
    border-radius: var(--radius-s);
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--separator);
    outline: none;
  }

  .row:last-child {
    border-bottom: 0;
  }

  .row:focus-visible {
    background: var(--row-hover);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .row.dragging {
    opacity: 0.5;
  }

  .row.drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .row.drop-after {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .handle {
    flex: none;
    width: 18px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-tertiary);
    font-size: 14px;
    cursor: grab;
    touch-action: none;
  }

  .handle:active {
    cursor: grabbing;
  }

  .action {
    flex: none;
    width: 214px;
    padding: 3px 6px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
  }

  .action:focus-visible,
  .message:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .sha {
    flex: none;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    flex: none;
    color: var(--text-tertiary);
    font-size: 11.5px;
    font-style: italic;
  }

  .row.drop .subject,
  .row.drop .sha {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }

  .row.squash,
  .row.fixup {
    padding-left: 22px;
  }

  .row.reword .action {
    border-color: var(--accent);
  }

  .row.drop .action {
    color: var(--danger);
  }

  .moves {
    display: inline-flex;
    flex: none;
    gap: 2px;
  }

  .moves button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text-secondary);
  }

  .moves button:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--text);
  }

  .moves button:disabled {
    opacity: 0.35;
  }

  .message {
    box-sizing: border-box;
    width: 100%;
    margin-left: 26px;
    max-width: calc(100% - 26px);
    padding: 6px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 12.5px;
    resize: vertical;
  }

  .keys {
    flex: none;
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 11.5px;
  }

  .problem {
    flex: none;
    margin: 6px 0 0;
    color: var(--danger);
    font-size: 12.5px;
  }

  .problem.quiet {
    color: var(--text-secondary);
  }

  .buttons {
    display: flex;
    flex: none;
    gap: 8px;
    margin-top: 12px;
  }

  .grow {
    flex: 1;
  }

  .button {
    padding: 6px 14px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .button.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .button.primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
