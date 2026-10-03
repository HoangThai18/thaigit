<!--
  Hộp thoại nổi giữa cửa sổ (nền mờ): xác nhận hoặc form ngắn. Esc / bấm nền = Huỷ; Enter trong ô chữ = nút chính.
  Phím bấm bên trong hộp không lan ra ngoài (Esc không đóng luôn khung diff phía sau).
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { dialogs, type DialogStore, type FormValues } from '../stores/dialogs.svelte.ts';

  interface Props {
    store?: DialogStore;
  }

  let { store = dialogs }: Props = $props();

  const current = $derived(store.current);
  let confirmButton = $state<HTMLButtonElement | null>(null);
  let firstField = $state<HTMLElement | null>(null);
  let values = $state<Record<string, string | boolean>>({});
  let valuesFor = 0;

  // Hộp mới: nạp giá trị ban đầu của các ô (theo id hộp, không chạy lại khi người dùng gõ).
  $effect.pre(() => {
    const pending = current;
    if (!pending || pending.id === valuesFor) return;
    valuesFor = pending.id;
    values = pending.kind === 'form' ? Object.fromEntries(pending.fields.map((field) => [field.id, field.value])) : {};
  });

  const error = $derived(current?.kind === 'form' ? (current.validate?.(values as FormValues) ?? null) : null);

  $effect(() => {
    if (!current) return;
    if (current.kind === 'form' && firstField) {
      firstField.focus();
      if (firstField instanceof HTMLInputElement && firstField.type === 'text') firstField.select();
    } else if (confirmButton) {
      confirmButton.focus();
    }
  });

  function primary(): void {
    if (!current) return;
    if (current.kind === 'form') {
      if (error === null) store.submit({ ...values });
    } else {
      store.answer('confirm');
    }
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (!current || event.key !== 'Escape') return;
    event.preventDefault();
    store.answer('cancel');
  }

  function ondialogkeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      store.answer('cancel');
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'text') {
      event.preventDefault();
      primary();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if current}
  <div class="backdrop" role="presentation" onclick={() => store.answer('cancel')}>
    <div
      class="dialog glass"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby={current.message ? 'dialog-message' : undefined}
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={ondialogkeydown}
    >
      <h2 id="dialog-title">{current.title}</h2>
      {#if current.message}
        <p id="dialog-message" class="selectable">{current.message}</p>
      {/if}
      {#if current.kind === 'form'}
        <div class="fields">
          {#each current.fields as field, index (field.id)}
            {#if field.kind === 'checkbox'}
              <label class="check">
                <input
                  type="checkbox"
                  checked={values[field.id] === true}
                  onchange={(event) => (values[field.id] = event.currentTarget.checked)}
                />
                <span>{field.label}</span>
              </label>
            {:else if field.kind === 'select'}
              <label class="field">
                <span class="label">{field.label}</span>
                {#if index === 0}
                  <select
                    bind:this={firstField}
                    value={values[field.id]}
                    onchange={(event) => (values[field.id] = event.currentTarget.value)}
                  >
                    {#each field.options as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                {:else}
                  <select value={values[field.id]} onchange={(event) => (values[field.id] = event.currentTarget.value)}>
                    {#each field.options as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                {/if}
              </label>
            {:else}
              <label class="field">
                <span class="label">{field.label}</span>
                {#if index === 0}
                  <input
                    type="text"
                    class:mono={field.monospace}
                    bind:this={firstField}
                    value={values[field.id]}
                    placeholder={field.placeholder}
                    spellcheck="false"
                    autocomplete="off"
                    oninput={(event) => (values[field.id] = event.currentTarget.value)}
                  />
                {:else}
                  <input
                    type="text"
                    class:mono={field.monospace}
                    value={values[field.id]}
                    placeholder={field.placeholder}
                    spellcheck="false"
                    autocomplete="off"
                    oninput={(event) => (values[field.id] = event.currentTarget.value)}
                  />
                {/if}
              </label>
            {/if}
          {/each}
          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}
        </div>
      {/if}
      <div class="buttons">
        <button type="button" class="button" onclick={() => store.answer('cancel')}>{vi.dialog.cancel}</button>
        {#if current.kind === 'confirm' && current.secondaryTitle}
          <button type="button" class="button" onclick={() => store.answer('secondary')}>{current.secondaryTitle}</button>
        {/if}
        <button
          type="button"
          class="button primary"
          class:destructive={current.destructive}
          disabled={error !== null}
          bind:this={confirmButton}
          onclick={primary}>{current.confirmTitle}</button
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
    width: min(440px, calc(100vw - 48px));
    padding: 20px 22px 16px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 15px;
  }

  p {
    margin: 0 0 18px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 4px 0 18px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label {
    color: var(--text-secondary);
    font-size: 12px;
  }

  input[type='text'],
  select {
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

  input.mono {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  input[type='text']:focus,
  select:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
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

  .button.primary.destructive {
    background: var(--danger);
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
