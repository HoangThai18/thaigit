<!--
  Ô soạn commit (port CommitComposer của StagingView.swift): tóm tắt (đếm ngược 72 ký tự), mô tả, amend, nút commit lớn.
  Ctrl/⌘ + Enter để commit. Chưa stage gì mà có thay đổi thì nút thành "Stage tất cả & commit".
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { canCommit, commit, setAmend } from '../actions/commit.ts';
  import { prefillPendingMessage } from '../actions/history.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const draft = $derived(store.commitDraft);
  const remaining = $derived(72 - [...draft.summary].length);
  const suggestsStageAll = $derived(
    store.status.staged.length === 0 &&
      store.status.unstaged.length > 0 &&
      store.status.conflicts.length === 0 &&
      !draft.amend &&
      store.operation === null,
  );
  const check = $derived(canCommit(store));
  const enabled = $derived(
    draft.summary.trim() !== '' && (check.ok || suggestsStageAll) && store.busy === null,
  );
  const buttonTitle = $derived(
    draft.amend && store.operation === null
      ? vi.staging.amendButton
      : suggestsStageAll
        ? vi.staging.stageAllAndCommit
        : vi.staging.commitButton(store.status.staged.length, store.currentBranch ?? 'HEAD'),
  );
  let savedBeforeAmend: { summary: string; body: string } | null = null;

  // Mở repo đang merge / revert dở (hoặc thao tác vừa dừng vì xung đột): điền sẵn message git đã soạn.
  $effect(() => {
    if (store.operation === null) return;
    untrack(() => void prefillPendingMessage(store));
  });

  function submit(): void {
    if (!enabled) return;
    void commit(store, { stageAllFirst: suggestsStageAll });
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  async function toggleAmend(event: Event): Promise<void> {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    savedBeforeAmend = await setAmend(store, checked, savedBeforeAmend);
  }
</script>

<div class="composer">
  <div class="top">
    <strong>{vi.staging.commitTitle}</strong>
    <span class="grow"></span>
    <label class="amend" title={vi.staging.amendTip}>
      <input
        type="checkbox"
        checked={draft.amend}
        disabled={store.headOid === null || store.operation !== null}
        onchange={toggleAmend}
      />
      <span>{vi.staging.amend}</span>
    </label>
  </div>
  <div class="summary-field">
    <input
      class="summary"
      type="text"
      placeholder={vi.staging.summaryPlaceholder}
      aria-label={vi.staging.summaryPlaceholder}
      bind:value={draft.summary}
      {onkeydown}
    />
    {#if draft.summary !== ''}
      <span class="remaining" class:over={remaining < 0} title={vi.staging.summaryTip}>{remaining}</span>
    {/if}
  </div>
  <textarea
    class="body"
    rows="3"
    placeholder={vi.staging.bodyPlaceholder}
    aria-label={vi.staging.bodyPlaceholder}
    bind:value={draft.body}
    {onkeydown}
  ></textarea>
  <button type="button" class="commit" disabled={!enabled} title={vi.staging.commitShortcut} onclick={submit}>
    <Icon name="commit" size={16} />
    <span>{buttonTitle}</span>
  </button>
  {#if !enabled && store.busy === null}
    <p class="hint">{check.reason ?? vi.staging.needSummary}</p>
  {/if}
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: none;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--separator);
  }

  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .grow {
    flex: 1;
  }

  .amend {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .summary-field {
    position: relative;
  }

  .summary,
  .body {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  .summary {
    padding-right: 38px;
  }

  .body {
    resize: vertical;
    min-height: 60px;
  }

  .summary:focus,
  .body:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .remaining {
    position: absolute;
    top: 50%;
    right: 9px;
    transform: translateY(-50%);
    color: var(--text-tertiary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .remaining.over {
    color: var(--warning);
  }

  .commit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 12px;
    border: none;
    border-radius: var(--radius-m);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .commit:disabled {
    background: var(--chip-fill);
    color: var(--text-tertiary);
    cursor: default;
  }

  .hint {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 11.5px;
    text-align: center;
  }
</style>
