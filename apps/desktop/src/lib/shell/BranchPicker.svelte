<!--
  Hộp "Chuyển nhánh" (Ctrl/⌘ + B, port SwitchBranchSheet.swift): gõ để tìm trong mọi nhánh local + remote, ↑↓ chọn, Enter
  checkout, Esc đóng. Chưa gõ gì thì là các nhánh local gần đây và mặc định chọn nhánh khác nhánh hiện tại (như
  `git checkout -`). Nhánh remote → tạo nhánh local theo dõi (xem `checkout` ở actions/branches.ts).
-->
<script lang="ts">
  import { refName, type GitRef } from '@thaigit/core';
  import { checkout } from '../actions/branches.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import { RECENT_LIMIT, defaultChoice, filterBranches } from './branchPicker.ts';

  interface Props {
    store: RepoStore;
    onclose: () => void;
  }

  let { store, onclose }: Props = $props();

  let query = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let listElement = $state<HTMLElement | null>(null);
  const items = $derived(
    filterBranches(query, {
      recent: store.recentLocalBranches(RECENT_LIMIT),
      local: store.localBranches,
      remote: store.remoteBranches,
      remotes: store.remotes.map((remote) => remote.name),
    }),
  );
  // When the list changes (typing more characters, opening the box) re-select the default entry; ↑↓ / hover override it temporarily.
  let highlighted = $derived(defaultChoice(items));
  const current = $derived(items[highlighted]);

  $effect(() => {
    input?.focus();
  });

  function move(step: number): void {
    if (items.length === 0) return;
    highlighted = Math.min(items.length - 1, Math.max(0, highlighted + step));
    listElement?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function choose(ref: GitRef | undefined): void {
    if (!ref || ref.isHead) return;
    onclose();
    void checkout(store, ref);
  }

  function onkeydown(event: KeyboardEvent): void {
    // Keys inside the box must not escape (Esc shouldn't also close the diff pane behind, repo shortcuts must not fire).
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(current);
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}>
  <div
    class="picker glass"
    role="dialog"
    aria-modal="true"
    aria-labelledby="branch-picker-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    {onkeydown}
  >
    <h2 id="branch-picker-title"><Icon name="branch" size={16} /> {vi.branches.pickerTitle}</h2>
    <input
      type="text"
      bind:this={input}
      bind:value={query}
      placeholder={vi.branches.pickerPlaceholder}
      aria-label={vi.branches.pickerPlaceholder}
      aria-controls="branch-picker-list"
      aria-activedescendant={highlighted >= 0 ? `branch-picker-${highlighted}` : undefined}
      spellcheck="false"
      autocomplete="off"
    />
    <ul id="branch-picker-list" class="list" role="listbox" bind:this={listElement}>
      {#each items as ref, index (index)}
        <li
          id="branch-picker-{index}"
          data-index={index}
          role="option"
          aria-selected={index === highlighted}
          class:highlighted={index === highlighted}
          class:head={ref.isHead}
          onpointermove={() => (highlighted = index)}
          onclick={() => choose(ref)}
          onkeydown={() => {}}
        >
          <Icon name={ref.kind === 'remoteBranch' ? 'cloud' : 'branch'} size={14} />
          <span class="name"><bdi>{showBidi(refName(ref))}</bdi></span>
          {#if ref.isHead}
            <span class="chip">{vi.branches.pickerCurrent}</span>
          {:else if ref.kind === 'remoteBranch'}
            <span class="chip muted">{vi.branches.pickerRemote}</span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="footer">
      <span class="hint">
        {#if items.length === 0}
          {vi.branches.pickerEmpty}
        {:else}
          {query.trim() === '' ? `${vi.branches.pickerRecent} · ` : ''}{vi.branches.pickerHint}
        {/if}
      </span>
      <button type="button" class="button" onclick={onclose}>{vi.dialog.cancel}</button>
      <button
        type="button"
        class="button primary"
        disabled={!current || current.isHead}
        onclick={() => choose(current)}>{vi.branches.checkout}</button
      >
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    background: rgb(0 0 0 / 0.28);
  }

  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(560px, calc(100vw - 48px));
    padding: 16px 18px 14px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 15px;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .list {
    height: 320px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-s);
    color: var(--text);
    font-size: 13px;
    white-space: nowrap;
    cursor: default;
  }

  li :global(svg) {
    flex: none;
    color: var(--text-secondary);
  }

  li.highlighted {
    background: var(--row-selected-focus);
  }

  li.head {
    color: var(--text-secondary);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip {
    flex: none;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
  }

  .chip.muted {
    background: var(--chip-fill);
    color: var(--text-secondary);
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hint {
    flex: 1;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .button {
    padding: 5px 14px;
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

  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
