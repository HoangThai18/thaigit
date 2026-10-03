<!--
  Tiến độ cài bản cập nhật (góc dưới trái): tải → kiểm chữ ký → cài → khởi động lại; lỗi thì có Thử lại / Đóng.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import { updates, type UpdateStore } from '../stores/update.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store?: UpdateStore;
  }

  let { store = updates }: Props = $props();

  const progress = $derived(store.progress);

  function size(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  const label = $derived.by(() => {
    switch (progress?.phase) {
      case 'downloading':
        return vi.update.downloading;
      case 'verifying':
        return vi.update.verifying;
      case 'installing':
        return vi.update.installing;
      case 'ready':
        return vi.update.ready;
      case 'failed':
        return vi.update.failed;
      default:
        return '';
    }
  });
  const fraction = $derived(
    progress?.phase === 'downloading' && progress.total ? Math.min(1, progress.downloaded / progress.total) : null,
  );
</script>

{#if progress}
  <div class="update glass" class:failed={progress.phase === 'failed'} role="status" aria-live="polite">
    <span class="icon"><Icon name={progress.phase === 'failed' ? 'x-circle' : 'download'} size={16} /></span>
    <div class="text">
      <strong>{label}{store.available ? ` — ${store.available.version}` : ''}</strong>
      {#if progress.phase === 'downloading' && progress.downloaded > 0}
        <span class="detail"
          >{vi.update.progressBytes(size(progress.downloaded), progress.total ? size(progress.total) : null)}</span
        >
      {:else if progress.phase === 'failed' && progress.message}
        <span class="detail">{progress.message}</span>
      {/if}
      {#if progress.phase !== 'failed'}
        <span class="bar" class:indeterminate={fraction === null}
          ><span class="fill" style:width={fraction === null ? undefined : `${Math.round(fraction * 100)}%`}></span></span
        >
      {/if}
    </div>
    {#if progress.phase === 'failed'}
      {#if store.available}
        <button type="button" class="button" onclick={() => void store.install(false)}>{vi.update.retry}</button>
      {/if}
      <button type="button" class="button" onclick={() => store.dismissProgress()}>{vi.update.close}</button>
    {/if}
  </div>
{/if}

<style>
  .update {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 700;
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(380px, calc(100vw - 32px));
    padding: 10px 12px;
    border-radius: var(--radius-l);
    font-size: 12.5px;
  }

  .icon {
    display: grid;
    flex: none;
    color: var(--accent);
  }

  .failed .icon {
    color: var(--danger);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 4px;
    min-width: 0;
  }

  .detail {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    position: relative;
    height: 5px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--chip-fill);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.12s linear;
  }

  .bar.indeterminate .fill {
    width: 35%;
    animation: slide 1.1s ease-in-out infinite;
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar.indeterminate .fill {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  }

  .button {
    flex: none;
    padding: 3px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
</style>
