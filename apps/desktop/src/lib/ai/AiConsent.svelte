<!--
  Hộp đồng ý dùng AI (trước lần gửi đầu tiên) và "Xem dữ liệu sẽ gửi". Nói rõ gửi gì, gửi đi đâu; phần xem trước liệt kê
  đúng nội dung body request (file gửi nội dung, file chỉ gửi tên + lý do, số đoạn đã bỏ vì nghi chứa bí mật). Mọi chữ đến
  từ repo (đường dẫn, diff, subject) đều vẽ dạng chữ thường.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { ai as defaultStore, type AiStore } from '../stores/ai.svelte.ts';

  interface Props {
    store?: AiStore;
  }

  let { store = defaultStore }: Props = $props();

  const pending = $derived(store.pending);
  let showPreview = $state(false);
  let primaryButton = $state<HTMLButtonElement | null>(null);
  let shownFor = 0;

  $effect.pre(() => {
    if (!pending || pending.id === shownFor) return;
    shownFor = pending.id;
    showPreview = pending.mode === 'preview';
  });

  $effect(() => {
    if (pending && primaryButton) primaryButton.focus();
  });

  const statusText: Record<string, string> = vi.ai.previewStatus;

  function onwindowkeydown(event: KeyboardEvent): void {
    if (!pending || event.key !== 'Escape') return;
    event.preventDefault();
    store.answer(false);
  }

  function ondialogkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      store.answer(false);
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if pending}
  {@const preview = pending.preview}
  <div class="backdrop" role="presentation" onclick={() => store.answer(false)}>
    <div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={ondialogkeydown}
    >
      <h2 id="ai-consent-title">
        <span aria-hidden="true">✨</span>
        {pending.mode === 'consent' ? vi.ai.consentTitle : vi.ai.previewTitle}
      </h2>

      {#if pending.mode === 'consent'}
        <dl class="facts">
          <dt>{vi.ai.consentWhat}</dt>
          <dd>{vi.ai.consentWhatText}</dd>
          <dt>{vi.ai.consentWhere}</dt>
          <dd>{vi.ai.consentWhereText}</dd>
          <dt>{vi.ai.consentLimits}</dt>
          <dd>{vi.ai.consentLimitsText}</dd>
        </dl>
        <button
          type="button"
          class="link"
          onclick={() => (showPreview = !showPreview)}
          aria-expanded={showPreview}
        >
          {showPreview ? vi.ai.consentHidePreview : vi.ai.consentPreview}
        </button>
      {/if}

      {#if showPreview}
        <div class="preview selectable">
          {#if preview.branch}
            <p class="meta">{vi.ai.previewBranch(preview.branch)}</p>
          {/if}
          {#if preview.redactions > 0}
            <p class="redacted">{vi.ai.previewRedacted(preview.redactions)}</p>
          {/if}
          {#if preview.files.length > 0}
            <h3>{vi.ai.previewSent(preview.files.length)}</h3>
            {#each preview.files as file (file.path)}
              <details>
                <summary>
                  <span class="path">{file.path}</span>
                  <span class="stat">
                    {statusText[file.status] ?? file.status} · +{file.additions} −{file.deletions}{file.truncated
                      ? ` · ${vi.ai.previewTruncated}`
                      : ''}
                  </span>
                </summary>
                <pre>{file.patch}</pre>
              </details>
            {/each}
          {/if}
          {#if preview.skipped.length > 0}
            <h3>{vi.ai.previewSkipped(preview.skipped.length)}</h3>
            <ul class="skipped">
              {#each preview.skipped as item (item.path)}
                <li>
                  <span class="path">{item.path}</span>
                  <span class="stat">{vi.ai.skipReason[item.reason] ?? item.reason}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if preview.subjects.length > 0}
            <h3>{vi.ai.previewSubjects}</h3>
            <ul class="subjects">
              {#each preview.subjects as subject, index (index)}
                <li>{subject}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="buttons">
        {#if pending.mode === 'consent'}
          <button type="button" class="button" onclick={() => store.answer(false)}>{vi.ai.cancel}</button>
          <button
            type="button"
            class="button primary"
            bind:this={primaryButton}
            onclick={() => store.answer(true)}>{vi.ai.consentAccept}</button
          >
        {:else}
          <button
            type="button"
            class="button primary"
            bind:this={primaryButton}
            onclick={() => store.answer(false)}>{vi.ai.previewClose}</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

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
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 80px);
    padding: 20px 22px 16px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    display: flex;
    gap: 6px;
    margin: 0 0 12px;
    font-size: 15px;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 14px;
    margin: 0 0 12px;
    font-size: 12.5px;
    line-height: 1.45;
  }

  dt {
    color: var(--text);
    font-weight: 600;
  }

  dd {
    margin: 0;
    color: var(--text-secondary);
  }

  .link {
    align-self: flex-start;
    margin: 0 0 10px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .preview {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-m);
    background: var(--field-fill);
    font-size: 12px;
  }

  .preview h3 {
    margin: 10px 0 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .preview h3:first-child {
    margin-top: 0;
  }

  .meta,
  .redacted {
    margin: 0 0 6px;
  }

  .redacted {
    color: var(--warning);
  }

  details {
    margin-bottom: 4px;
  }

  summary {
    display: flex;
    gap: 8px;
    cursor: pointer;
  }

  .path {
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
  }

  .stat {
    flex: none;
    margin-left: auto;
    color: var(--text-tertiary);
  }

  pre {
    margin: 6px 0 8px;
    padding: 8px;
    max-height: 220px;
    overflow: auto;
    border-radius: var(--radius-s);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 11.5px;
    white-space: pre;
  }

  ul {
    margin: 0;
    padding-left: 0;
    list-style: none;
  }

  .skipped li {
    display: flex;
    gap: 8px;
    margin-bottom: 2px;
  }

  .subjects li {
    margin-bottom: 2px;
    color: var(--text-secondary);
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

  .button:focus-visible,
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
