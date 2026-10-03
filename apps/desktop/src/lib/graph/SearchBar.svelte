<!--
  Ô tìm commit nổi ở đáy graph (Ctrl/⌘ + F): gõ để lọc, Enter / ↓ tới kết quả sau, Shift + Enter / ↑ kết quả trước, Esc đóng.
-->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import type { GraphSearch } from './search.svelte.ts';

  interface Props {
    search: GraphSearch;
  }

  let { search }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (search.open && input) {
      input.focus();
      input.select();
    }
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      search.close();
    } else if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      search.next(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey));
    }
  }
</script>

{#if search.open}
  <div class="search glass" role="search">
    <Icon name="search" size={14} />
    <input
      type="text"
      bind:this={input}
      bind:value={search.query}
      placeholder={vi.graph.searchPlaceholder}
      aria-label={vi.graph.searchPlaceholder}
      spellcheck="false"
      autocomplete="off"
      {onkeydown}
    />
    {#if search.query.trim() !== ''}
      <span class="count" aria-live="polite">
        {search.matches.length === 0 ? vi.graph.searchNone : vi.graph.searchCount(search.matches.length)}
      </span>
    {/if}
    <button
      type="button"
      title={vi.graph.searchPrevious}
      aria-label={vi.graph.searchPrevious}
      disabled={search.matches.length === 0}
      onclick={() => search.next(true)}><Icon name="chevron-up" size={13} /></button
    >
    <button
      type="button"
      title={vi.graph.searchNext}
      aria-label={vi.graph.searchNext}
      disabled={search.matches.length === 0}
      onclick={() => search.next()}><Icon name="chevron-down" size={13} /></button
    >
    <button
      type="button"
      title={vi.graph.searchClose}
      aria-label={vi.graph.searchClose}
      onclick={() => search.close()}><Icon name="x" size={12} strokeWidth={2.4} /></button
    >
  </div>
{/if}

<style>
  .search {
    position: absolute;
    left: 50%;
    bottom: 14px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(520px, calc(100% - 32px));
    padding: 6px 8px 6px 12px;
    border-radius: 999px;
    box-shadow: var(--glass-shadow);
    transform: translateX(-50%);
    font-size: 12.5px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
  }

  .count {
    flex: none;
    color: var(--text-secondary);
  }

  button {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--row-hover);
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
