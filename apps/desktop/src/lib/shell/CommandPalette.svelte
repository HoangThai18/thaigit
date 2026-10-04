<!--
  Command palette (Ctrl/⌘ + P, port CommandPalette.swift): gõ để tìm thao tác (fetch, pull, push, stash, tạo nhánh, cài đặt…),
  nhánh / tag để checkout, hoặc file đang thay đổi để xem diff. ↑↓ chọn, Enter chạy, Esc đóng. Các thao tác lấy lại từ menu
  sẵn có (menu WIP, menu Thêm) nên không khai báo hai lần.
-->
<script lang="ts">
  import { conflictAsChange, fileChangeName, refName } from '@thaigit/core';
  import { beginCreateBranch, checkout } from '../actions/branches.ts';
  import { beginAddRemote } from '../actions/manageRemotes.ts';
  import { repoForgeItems, repoOsItems, workingTreeMenu } from '../actions/menus.ts';
  import { fetch, pull, push, sync } from '../actions/remote.ts';
  import { popLatestStash } from '../actions/stash.ts';
  import { showBidi } from '../format/bidi.ts';
  import { newWindow } from '../ipc/os.ts';
  import { app } from '../stores/app.svelte.ts';
  import { hasTauriInternals } from '../platform/host.ts';
  import { tidyMenu, type MenuItem } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { settingsStore } from '../stores/settings.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import {
    fileToPalette,
    filterPalette,
    menuToPalette,
    refToPalette,
    type PaletteItem,
  } from './commandPalette.ts';

  interface Props {
    store: RepoStore;
    onclose: () => void;
    onsearch: () => void;
    onshowlog: () => void;
    onbranchpicker: () => void;
  }

  let { store, onclose, onsearch, onshowlog, onbranchpicker }: Props = $props();

  let query = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let listElement = $state<HTMLElement | null>(null);

  function actions(): MenuItem[] {
    return tidyMenu([
      { title: vi.remote.fetch, icon: 'fetch', shortcut: 'Ctrl/⌘ + Alt + F', run: () => void fetch(store) },
      { title: vi.palette.pull, icon: 'pull', shortcut: 'Ctrl/⌘ + Shift + L', run: () => void pull(store) },
      { title: vi.remote.pullMerge, icon: 'merge', run: () => void pull(store, 'merge') },
      { title: vi.remote.pullRebase, icon: 'rebase', run: () => void pull(store, 'rebase') },
      {
        title: vi.remote.pullFastForward,
        icon: 'fast-forward',
        run: () => void pull(store, 'fastForwardOnly'),
      },
      { title: vi.remote.push, icon: 'push', shortcut: 'Ctrl/⌘ + Shift + P', run: () => void push(store) },
      { title: vi.remote.syncBranch, icon: 'push', run: () => void sync(store) },
      {
        title: vi.branches.pickerOpen,
        icon: 'branch',
        shortcut: vi.branches.pickerShortcut,
        run: onbranchpicker,
      },
      {
        title: vi.branches.createTitle,
        icon: 'branch',
        shortcut: 'Ctrl/⌘ + Shift + B',
        run: () => void beginCreateBranch(store),
      },
      ...workingTreeMenu(store),
      { title: vi.branches.popTitle, icon: 'stash', run: () => void popLatestStash(store) },
      { title: vi.graph.search, icon: 'search', shortcut: 'Ctrl/⌘ + F', run: onsearch },
      { title: vi.remote.refresh, icon: 'reset', run: () => store.refreshEverything() },
      { title: vi.remote.commandLog, icon: 'terminal', run: onshowlog },
      { title: vi.snapshots.open, icon: 'clock', run: () => store.timeline.open() },
      { title: vi.remote.addRemote, icon: 'cloud', run: () => void beginAddRemote(store) },
      ...repoForgeItems(store),
      ...repoOsItems(store),
      app.newTab && {
        title: vi.tabs.newTab,
        shortcut: vi.tabs.newTabShortcut,
        run: () => app.newTab?.(),
      },
      hasTauriInternals() && {
        title: vi.welcome.newWindow,
        shortcut: vi.tabs.newWindowShortcut,
        run: () =>
          void newWindow().catch((error: unknown) => toasts.error(vi.welcome.newWindowFailed, error)),
      },
      {
        title: vi.settings.open,
        icon: 'settings',
        shortcut: vi.settings.shortcut,
        run: () => settingsStore.open(),
      },
    ]);
  }

  function allItems(): PaletteItem[] {
    const items = menuToPalette(actions());
    for (const ref of [...store.localBranches, ...store.remoteBranches]) {
      if (ref.isHead) continue;
      items.push(refToPalette(ref, vi.palette.checkoutBranch(refName(ref)), () => void checkout(store, ref)));
    }
    for (const ref of store.tags) {
      items.push(refToPalette(ref, vi.palette.checkoutTag(refName(ref)), () => void checkout(store, ref)));
    }
    const status = store.status;
    for (const [list, source] of [
      [status.conflicts.map((entry) => conflictAsChange(entry)), { kind: 'conflict' }],
      [status.unstaged, { kind: 'unstaged' }],
      [status.staged, { kind: 'staged' }],
    ] as const) {
      for (const change of list) {
        items.push(
          fileToPalette(change, vi.palette.openDiff(fileChangeName(change)), () =>
            store.diff.open(change, source),
          ),
        );
      }
    }
    return items;
  }

  // Dựng một lần khi mở (trạng thái repo không đổi trong lúc gõ vài chữ).
  const items = allItems();
  const results = $derived(filterPalette(query, items));
  let highlighted = $derived(results.length > 0 ? 0 : -1);
  const current = $derived(results[highlighted]);

  $effect(() => {
    input?.focus();
  });

  function move(step: number): void {
    if (results.length === 0) return;
    highlighted = Math.min(results.length - 1, Math.max(0, highlighted + step));
    listElement?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function choose(item: PaletteItem | undefined): void {
    if (!item) return;
    onclose();
    item.run();
  }

  function groupLabel(item: PaletteItem): string | null {
    if (item.group === 'branch') return vi.palette.groupBranch;
    if (item.group === 'tag') return vi.palette.groupTag;
    if (item.group === 'file') return vi.palette.groupFile;
    return null;
  }

  function onkeydown(event: KeyboardEvent): void {
    // Phím trong hộp không lan ra ngoài (Esc không đóng luôn khung diff phía sau, phím tắt repo không chạy).
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
    aria-label={vi.palette.title}
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    {onkeydown}
  >
    <input
      type="text"
      bind:this={input}
      bind:value={query}
      placeholder={vi.palette.placeholder}
      aria-label={vi.palette.placeholder}
      aria-controls="command-palette-list"
      aria-activedescendant={highlighted >= 0 ? `command-palette-${highlighted}` : undefined}
      spellcheck="false"
      autocomplete="off"
    />
    <ul id="command-palette-list" class="list" role="listbox" bind:this={listElement}>
      {#each results as item, index (index)}
        {@const group = groupLabel(item)}
        <li
          id="command-palette-{index}"
          data-index={index}
          role="option"
          aria-selected={index === highlighted}
          class:highlighted={index === highlighted}
          onpointermove={() => (highlighted = index)}
          onclick={() => choose(item)}
          onkeydown={() => {}}
        >
          <Icon name={item.icon} size={14} />
          <span class="name"><bdi>{showBidi(item.title)}</bdi></span>
          {#if item.detail && item.group === 'file'}
            <span class="detail"><bdi>{showBidi(item.detail)}</bdi></span>
          {/if}
          {#if item.shortcut}
            <span class="shortcut">{item.shortcut}</span>
          {:else if group}
            <span class="chip">{group}</span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="footer">
      <span class="hint">{results.length === 0 ? vi.palette.empty : vi.palette.hint}</span>
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
    width: min(620px, calc(100vw - 48px));
    padding: 14px 14px 10px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 11px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .list {
    max-height: 360px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
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

  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 12px;
    text-overflow: ellipsis;
  }

  .shortcut,
  .chip {
    flex: none;
    margin-left: auto;
    color: var(--text-tertiary);
    font-size: 11.5px;
  }

  .chip {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .footer {
    display: flex;
    align-items: center;
  }

  .hint {
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
