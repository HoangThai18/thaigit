<!--
  Ô soạn commit (port CommitComposer của StagingView.swift): tóm tắt (đếm ngược 72 ký tự), mô tả, amend, nút commit lớn.
  Ctrl/⌘ + Enter để commit. Chưa stage gì mà có thay đổi thì nút thành "Stage tất cả & commit".
  "✨ Viết bằng AI" (Ctrl/⌘ + Shift + G): AI viết message từ thay đổi đã stage, chữ hiện dần; Dừng / Hoàn tác / tuỳ chọn.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { canCommit, commit, setAmend } from '../actions/commit.ts';
  import { prefillPendingMessage } from '../actions/history.ts';
  import { CommitWriter } from '../ai/commitWriter.svelte.ts';
  import { AI_ENABLED } from '../ai/enabled.ts';
  import { commitContext } from '../ai/context.ts';
  import { vi } from '../strings.vi.ts';
  import { ai } from '../stores/ai.svelte.ts';
  import { menus, tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
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
  const writer = untrack(() => new CommitWriter(store, ai));
  const remainingAi = $derived(ai.remaining('commit'));
  const aiStatus = $derived(
    writer.phase === 'queued'
      ? vi.ai.queued(writer.position)
      : writer.phase === 'writing'
        ? vi.ai.writing
        : null,
  );

  // Đã đồng ý dùng AI: đọc lượt còn lại để hiện cạnh nút (không gửi nội dung gì).
  $effect(() => {
    if (AI_ENABLED && ai.consented) untrack(() => void ai.refreshQuota());
  });

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

  function onwindowkeydown(event: KeyboardEvent): void {
    if (AI_ENABLED && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (writer.running) writer.stop();
      else void writer.start();
    }
  }

  async function previewPayload(): Promise<void> {
    try {
      const prepared = await commitContext(store.git, ai, {
        branch: store.currentBranch,
        oid: store.headOid,
        amend: draft.amend,
      });
      if (prepared === null) toasts.info(vi.ai.nothingToSend);
      else ai.showPreview(prepared.preview);
    } catch (error) {
      toasts.error(vi.ai.errors.title, error);
    }
  }

  function openAiOptions(event: MouseEvent): void {
    const { language, length, conventional } = ai.saved.options;
    const items: (MenuItem | false)[] = [
      { kind: 'header', title: vi.ai.menuLanguage },
      {
        title: vi.ai.languageAuto,
        checked: language === 'auto',
        run: () => ai.setOptions({ language: 'auto' }),
      },
      { title: vi.ai.languageVi, checked: language === 'vi', run: () => ai.setOptions({ language: 'vi' }) },
      { title: vi.ai.languageEn, checked: language === 'en', run: () => ai.setOptions({ language: 'en' }) },
      { kind: 'separator' },
      { kind: 'header', title: vi.ai.menuLength },
      {
        title: vi.ai.lengthShort,
        checked: length === 'short',
        run: () => ai.setOptions({ length: 'short' }),
      },
      {
        title: vi.ai.lengthNormal,
        checked: length === 'normal',
        run: () => ai.setOptions({ length: 'normal' }),
      },
      {
        title: vi.ai.lengthDetailed,
        checked: length === 'detailed',
        run: () => ai.setOptions({ length: 'detailed' }),
      },
      { kind: 'separator' },
      {
        title: vi.ai.conventional,
        checked: conventional,
        run: () => ai.setOptions({ conventional: !conventional }),
      },
      { kind: 'separator' },
      { title: vi.ai.previewMenu, run: () => void previewPayload() },
      ai.consented && {
        title: vi.ai.disable,
        destructive: true,
        run: () => {
          ai.disable();
          toasts.info(vi.ai.disabledToast);
        },
      },
    ];
    menus.openBelow(event.currentTarget as HTMLElement, tidyMenu(items));
  }

  async function toggleAmend(event: Event): Promise<void> {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    savedBeforeAmend = await setAmend(store, checked, savedBeforeAmend);
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="composer">
  <div class="top">
    <strong>{vi.staging.commitTitle}</strong>
    <span class="grow"></span>
    {#if AI_ENABLED}
      <div class="ai" class:running={writer.running}>
        {#if writer.running}
          <button type="button" class="ai-main" onclick={() => writer.stop()} title={vi.ai.stop}>
            <Icon name="stop" size={13} />
            <span>{vi.ai.stop}</span>
          </button>
        {:else}
          <button
            type="button"
            class="ai-main"
            onclick={() => void writer.start()}
            disabled={store.busy !== null}
            title={vi.ai.writeTip}
          >
            <Icon name="sparkles" size={14} />
            <span>{vi.ai.write}</span>
          </button>
        {/if}
        <button
          type="button"
          class="ai-more"
          aria-label={vi.ai.options}
          title={vi.ai.options}
          onclick={openAiOptions}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
    {/if}
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
    {onkeydown}></textarea>
  {#if AI_ENABLED && (aiStatus || writer.previous || (ai.consented && remainingAi !== null))}
    <div class="ai-status" aria-live="polite">
      {#if aiStatus}
        <Icon name="spinner" size={12} />
        <span>{aiStatus}</span>
      {:else}
        {#if writer.previous}
          <button type="button" class="ai-link" onclick={() => void writer.start()}>{vi.ai.regenerate}</button
          >
          <button type="button" class="ai-link" title={vi.ai.undoTip} onclick={() => writer.undo()}
            >{vi.ai.undo}</button
          >
        {/if}
        {#if remainingAi !== null}
          <span class="grow"></span>
          <span class="ai-remaining">{vi.ai.remaining(remainingAi)}</span>
        {/if}
      {/if}
    </div>
  {/if}
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
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }

  .grow {
    flex: 1;
  }

  .ai {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    overflow: hidden;
  }

  .ai button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    border: none;
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .ai-main {
    padding: 3px 8px;
  }

  .ai-main:not(:disabled) :global(svg) {
    color: var(--accent);
  }

  .ai.running .ai-main :global(svg) {
    color: var(--danger);
  }

  .ai-more {
    padding: 3px 5px;
    border-left: 1px solid var(--field-border) !important;
  }

  .ai button:disabled {
    color: var(--text-tertiary);
    cursor: default;
  }

  .ai button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .ai-status {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 16px;
    margin-top: -2px;
    color: var(--text-secondary);
    font-size: 11.5px;
  }

  .ai-status :global(svg) {
    animation: ai-spin 0.9s linear infinite;
  }

  @keyframes ai-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .ai-link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .ai-remaining {
    color: var(--text-tertiary);
  }

  .amend {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
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
