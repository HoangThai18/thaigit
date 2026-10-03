<!-- Hộp thoại xác nhận nổi giữa cửa sổ (kính, nền mờ). Esc / bấm nền = Huỷ, Enter = nút chính. -->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { dialogs, type DialogStore } from '../stores/dialogs.svelte.ts';

  interface Props {
    store?: DialogStore;
  }

  let { store = dialogs }: Props = $props();

  const current = $derived(store.current);
  let confirmButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (current && confirmButton) confirmButton.focus();
  });

  function onkeydown(event: KeyboardEvent): void {
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      store.answer('cancel');
    }
  }
</script>

<svelte:window {onkeydown} />

{#if current}
  <div class="backdrop" role="presentation" onclick={() => store.answer('cancel')}>
    <div
      class="dialog glass"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-message"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <h2 id="dialog-title">{current.title}</h2>
      <p id="dialog-message" class="selectable">{current.message}</p>
      <div class="buttons">
        <button type="button" class="button" onclick={() => store.answer('cancel')}>{vi.dialog.cancel}</button>
        {#if current.secondaryTitle}
          <button type="button" class="button" onclick={() => store.answer('secondary')}>{current.secondaryTitle}</button>
        {/if}
        <button
          type="button"
          class="button primary"
          class:destructive={current.destructive}
          bind:this={confirmButton}
          onclick={() => store.answer('confirm')}>{current.confirmTitle}</button
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

  .button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
