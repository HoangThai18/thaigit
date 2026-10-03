<!--
  Các nút thao tác trên thanh công cụ (port RepoActionBar.swift): Fetch, Pull (bấm = kiểu pull trong cài đặt, ▾ = chọn kiểu
  khác), Push, Branch, Stash, Pop và menu "Thêm". Cửa sổ hẹp thì chỉ còn biểu tượng (chú thích vẫn hiện khi rê chuột).
-->
<script lang="ts">
  import { isStatusClean } from '@thaigit/core';
  import { beginCreateBranch } from '../actions/branches.ts';
  import { fetch, pull, push } from '../actions/remote.ts';
  import { popLatestStash, quickStash } from '../actions/stash.ts';
  import { repoForgeItems, repoOsItems } from '../actions/menus.ts';
  import { newWindow } from '../ipc/os.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import { hasTauriInternals } from '../platform/host.ts';
  import { menus, tidyMenu } from '../stores/menus.svelte.ts';
  import { settingsStore } from '../stores/settings.svelte.ts';
  import { updates } from '../stores/update.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
    onshowlog: () => void;
    onsearch?: () => void;
  }

  let { store, onshowlog, onsearch }: Props = $props();

  const behind = $derived(store.status.behind);
  const ahead = $derived(store.status.ahead);
  const busy = $derived(store.busy !== null);
  let pullMenuButton = $state<HTMLButtonElement | null>(null);
  let moreButton = $state<HTMLButtonElement | null>(null);

  function openPullMenu(event: MouseEvent | KeyboardEvent): void {
    if (!pullMenuButton) return;
    menus.openBelow(
      pullMenuButton,
      [
        { title: vi.remote.pullMerge, icon: 'merge', run: () => void pull(store, 'merge') },
        { title: vi.remote.pullRebase, icon: 'rebase', run: () => void pull(store, 'rebase') },
        {
          title: vi.remote.pullFastForward,
          icon: 'fast-forward',
          run: () => void pull(store, 'fastForwardOnly'),
        },
        { kind: 'separator' },
        { title: vi.remote.fetchOnly, icon: 'fetch', run: () => void fetch(store) },
      ],
      { focusFirst: event.detail === 0 },
    );
  }

  function openMoreMenu(event: MouseEvent): void {
    if (!moreButton) return;
    const available = updates.available;
    menus.openBelow(
      moreButton,
      tidyMenu([
        onsearch && { title: vi.graph.search, icon: 'search', shortcut: 'Ctrl/⌘ + F', run: onsearch },
        { title: vi.remote.refresh, icon: 'reset', run: () => store.refreshEverything() },
        { title: vi.remote.commandLog, icon: 'terminal', run: onshowlog },
        { title: vi.snapshots.open, icon: 'clock', run: () => store.timeline.open() },
        { kind: 'separator' },
        ...repoForgeItems(store),
        { kind: 'separator' },
        ...repoOsItems(store),
        hasTauriInternals() && {
          title: vi.welcome.newWindow,
          shortcut: 'Ctrl/⌘ + T',
          run: () =>
            void newWindow().catch((error: unknown) => toasts.error(vi.welcome.newWindowFailed, error)),
        },
        { kind: 'separator' },
        {
          title: vi.settings.open,
          icon: 'settings',
          shortcut: vi.settings.shortcut,
          run: () => settingsStore.open(),
        },
        hasTauriInternals() &&
          (available
            ? {
                title: vi.update.installMenu(available.version),
                icon: 'download',
                run: () => void updates.install(),
              }
            : {
                title: vi.update.checkNow,
                icon: 'download',
                disabled: updates.checking || updates.installing,
                run: () => void updates.check(import.meta.env.VITE_APP_VERSION ?? ''),
              }),
      ]),
      { focusFirst: event.detail === 0 },
    );
  }
</script>

<div class="actions">
  <button
    type="button"
    class="action"
    title={vi.remote.fetchTip}
    disabled={busy}
    onclick={() => void fetch(store)}
  >
    <Icon name="fetch" size={16} />
    <span class="label">{vi.remote.fetch}</span>
  </button>

  <div class="split">
    <button
      type="button"
      class="action left"
      title={vi.remote.pullTip}
      disabled={busy}
      onclick={() => void pull(store)}
    >
      <Icon name="pull" size={16} />
      <span class="label">{behind > 0 ? vi.remote.pullBehind(behind) : vi.remote.pull}</span>
      {#if behind > 0}<span class="badge compact">{behind}</span>{/if}
    </button>
    <button
      type="button"
      class="action right"
      title={vi.remote.pullOptions}
      aria-label={vi.remote.pullOptions}
      aria-haspopup="menu"
      disabled={busy}
      bind:this={pullMenuButton}
      onclick={openPullMenu}
    >
      <Icon name="chevron-down" size={12} />
    </button>
  </div>

  <button
    type="button"
    class="action"
    title={vi.remote.pushTip}
    disabled={busy}
    onclick={() => void push(store)}
  >
    <Icon name="push" size={16} />
    <span class="label">{ahead > 0 ? vi.remote.pushAhead(ahead) : vi.remote.push}</span>
    {#if ahead > 0}<span class="badge compact">{ahead}</span>{/if}
  </button>

  <span class="gap"></span>

  <button
    type="button"
    class="action"
    title={vi.remote.branchTip}
    onclick={() => void beginCreateBranch(store)}
  >
    <Icon name="branch" size={16} />
    <span class="label">{vi.remote.branch}</span>
  </button>

  <button
    type="button"
    class="action"
    title={vi.remote.stashTip}
    disabled={isStatusClean(store.status)}
    onclick={() => void quickStash(store)}
  >
    <Icon name="stash" size={16} />
    <span class="label">{vi.remote.stash}</span>
  </button>

  <button
    type="button"
    class="action"
    title={vi.remote.popTip}
    disabled={store.stashes.length === 0}
    onclick={() => void popLatestStash(store)}
  >
    <Icon name="archive" size={16} />
    <span class="label">{vi.remote.pop}</span>
  </button>

  <button
    type="button"
    class="action icon-only"
    title={vi.remote.more}
    aria-label={vi.remote.more}
    aria-haspopup="menu"
    bind:this={moreButton}
    onclick={openMoreMenu}
  >
    <Icon name="more" size={16} />
  </button>
</div>

<style>
  .actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: 4px;
  }

  .gap {
    width: 8px;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12.5px;
    white-space: nowrap;
  }

  .action:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--text);
  }

  .action:disabled {
    opacity: 0.45;
  }

  .action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .action.icon-only {
    padding: 0 8px;
  }

  .split {
    display: inline-flex;
    align-items: center;
  }

  .action.left {
    padding-right: 6px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .action.right {
    padding: 0 6px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .badge {
    display: none;
    min-width: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* Cửa sổ hẹp: bỏ chữ, giữ biểu tượng (+ số commit trước/sau dạng huy hiệu). */
  @media (max-width: 1180px) {
    .label {
      display: none;
    }

    .badge.compact {
      display: inline-block;
    }

    .action {
      padding: 0 8px;
    }
  }
</style>
