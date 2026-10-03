<!--
  Hộp kết quả AI (giải thích commit, mô tả PR): chữ hiện dần, Dừng khi đang viết; xong thì Tạo lại / Sao chép / Đóng.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import Markdown from './Markdown.svelte';
  import { aiResult as defaultStore, type AiResultStore } from './result.svelte.ts';

  interface Props {
    store?: AiResultStore;
    copy?: (text: string) => Promise<void>;
  }

  let { store = defaultStore, copy = (text) => navigator.clipboard.writeText(text) }: Props = $props();

  const job = $derived(store.job);
  const status = $derived(
    store.phase === 'preparing' || store.phase === 'writing'
      ? vi.ai.writing
      : store.phase === 'queued'
        ? vi.ai.queued(store.position)
        : null,
  );
  let closeButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (job && closeButton) closeButton.focus();
  });

  async function copyText(): Promise<void> {
    try {
      await copy(store.text);
      toasts.success(vi.ai.copied);
    } catch (error) {
      toasts.error(vi.inspector.copyFailed, error);
    }
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (!job || event.key !== 'Escape') return;
    event.preventDefault();
    store.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if job}
  <div class="backdrop" role="presentation" onclick={() => store.close()}>
    <div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-result-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <h2 id="ai-result-title">
        <Icon name="sparkles" size={15} />
        <span>{job.title}</span>
      </h2>
      <div class="content" aria-live="polite">
        {#if store.text !== ''}
          <Markdown text={store.text} />
        {/if}
        {#if status}
          <p class="status"><Icon name="spinner" size={12} /><span>{status}</span></p>
        {/if}
        {#if store.phase === 'error' && store.error}
          <p class="error" role="alert">{store.error}</p>
        {/if}
      </div>
      <div class="buttons">
        {#if store.running}
          <button type="button" class="button" onclick={() => store.stop()}>{vi.ai.stop}</button>
        {:else}
          <button type="button" class="button" onclick={() => void store.regenerate()}
            >{vi.ai.regenerate}</button
          >
          {#if store.phase === 'done'}
            <button type="button" class="button" onclick={copyText}>{vi.ai.copy}</button>
          {/if}
        {/if}
        <button type="button" class="button primary" bind:this={closeButton} onclick={() => store.close()}
          >{vi.ai.close}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 880;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(620px, calc(100vw - 48px));
    max-height: calc(100vh - 80px);
    padding: 18px 22px 16px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
    font-size: 15px;
  }

  h2 :global(svg) {
    color: var(--accent);
  }

  .content {
    flex: 1 1 auto;
    min-height: 80px;
    overflow: auto;
    margin-bottom: 14px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .status :global(svg) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 12.5px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
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

  .button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
