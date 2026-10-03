<!--
  Hộp thoại tạo Pull Request / Merge Request: nhánh đích, tiêu đề, mô tả (nút ✨ viết bằng AI), nháp. Esc / bấm nền = Huỷ.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import {
    createPullRequest as defaultStore,
    type CreatePullRequestStore,
  } from '../forge/createPullRequest.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store?: CreatePullRequestStore;
  }

  let { store = defaultStore }: Props = $props();

  const current = $derived(store.current);
  const text = vi.pullRequests;
  let titleInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (current && titleInput) titleInput.focus();
  });

  function onwindowkeydown(event: KeyboardEvent): void {
    if (current && event.key === 'Escape') {
      event.preventDefault();
      store.close();
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') store.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if current}
  <div class="backdrop" role="presentation" onclick={() => store.close()}>
    <div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pr-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      {onkeydown}
    >
      <h2 id="create-pr-title">{text.createFrom(current.sourceBranch)}</h2>

      <label class="field">
        <span class="label">{text.targetBranch}</span>
        <select value={current.base} onchange={(event) => store.setBase(event.currentTarget.value)}>
          {#each current.bases as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">{text.title}</span>
        <input
          type="text"
          bind:this={titleInput}
          value={current.title}
          oninput={(event) => store.setTitle(event.currentTarget.value)}
          spellcheck="false"
        />
      </label>

      <div class="field">
        <div class="label-row">
          <span class="label">{text.body}</span>
          <button
            type="button"
            class="ai"
            disabled={current.writing}
            onclick={() => void store.writeDescription()}
          >
            <Icon name="sparkles" size={12} />
            <span>{current.writing ? text.writing : text.writeWithAi}</span>
          </button>
        </div>
        <textarea
          rows="7"
          value={current.body}
          placeholder={text.bodyHint}
          spellcheck="false"
          oninput={(event) => store.setBody(event.currentTarget.value)}></textarea>
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={current.draft}
          onchange={(event) => store.setDraft(event.currentTarget.checked)}
        />
        <span>{text.draftRequest}</span>
      </label>

      {#if current.error}
        <p class="error" role="alert">{current.error}</p>
      {/if}

      <div class="buttons">
        <button type="button" class="button" onclick={() => store.close()}>{vi.dialog.cancel}</button>
        <button
          type="button"
          class="button primary"
          disabled={current.submitting || current.title.trim() === ''}
          onclick={() => void store.submit()}>{current.submitting ? text.creating : text.submit}</button
        >
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
    gap: 12px;
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 64px);
    padding: 20px 22px 16px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .label {
    color: var(--text-secondary);
    font-size: 12px;
  }

  input[type='text'],
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  textarea {
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
  }

  input[type='text']:focus,
  select:focus,
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .ai {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .ai:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
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

  .button.primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .button:focus-visible,
  .ai:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
