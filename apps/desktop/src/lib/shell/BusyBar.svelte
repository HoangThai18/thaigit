<!--
  Thanh bận dưới thanh công cụ khi đang chạy thao tác dài (fetch / pull / push…): tên thao tác, dòng tiến độ của git, thanh
  phần trăm (khi git báo) và nút Huỷ cho thao tác mạng.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const busy = $derived(store.busy);
</script>

{#if busy}
  <div class="busy" role="status" aria-live="polite">
    <span class="spin"><Icon name="spinner" size={14} /></span>
    <strong>{busy.title}</strong>
    <span class="detail"><bdi>{busy.detail}</bdi></span>
    {#if busy.fraction !== null}
      <span class="bar" aria-hidden="true"
        ><span class="fill" style:width="{Math.round(busy.fraction * 100)}%"></span></span
      >
      <span class="percent">{Math.round(busy.fraction * 100)}%</span>
    {/if}
    {#if busy.canCancel}
      <button
        type="button"
        class="cancel"
        title={vi.remote.cancelTip}
        onclick={() => store.cancelCurrentOperation()}
      >
        {vi.remote.cancel}
      </button>
    {/if}
  </div>
{/if}

<style>
  .busy {
    display: flex;
    align-items: center;
    flex: none;
    gap: 9px;
    min-width: 0;
    height: 30px;
    padding: 0 14px;
    border-bottom: 1px solid var(--separator);
    background: var(--surface-muted);
    font-size: 12.5px;
  }

  .spin {
    display: grid;
    color: var(--accent);
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  strong {
    flex: none;
  }

  .detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    flex: none;
    width: 140px;
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

  .percent {
    flex: none;
    width: 34px;
    color: var(--text-secondary);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .cancel {
    flex: none;
    padding: 2px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
</style>
