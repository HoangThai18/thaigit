<!-- Hiện thay cho phần giao diện bị lỗi khi vẽ (svelte:boundary): chỉ câu thân thiện, không có nội dung exception. -->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    onretry: () => void;
    onhome: () => void;
  }

  let { onretry, onhome }: Props = $props();
</script>

<main class="crash">
  <section class="card glass" role="alert">
    <span class="icon"><Icon name="warning" size={28} /></span>
    <h1>{vi.errors.crashTitle}</h1>
    <p>{vi.errors.crashMessage}</p>
    <div class="buttons">
      <button type="button" class="button" onclick={onhome}>{vi.errors.crashHome}</button>
      <button type="button" class="button primary" onclick={onretry}>{vi.errors.crashRetry}</button>
    </div>
  </section>
</main>

<style>
  .crash {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: 440px;
    padding: 28px 30px 22px;
    border-radius: var(--radius-l);
    text-align: center;
  }

  .icon {
    display: grid;
    color: var(--warning);
  }

  h1 {
    margin: 0;
    font-size: 17px;
  }

  p {
    margin: 0 0 8px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }

  .buttons {
    display: flex;
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
</style>
