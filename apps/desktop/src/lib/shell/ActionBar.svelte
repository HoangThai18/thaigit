<!--
  Các nút thao tác trên thanh công cụ (port RepoActionBar.swift): Fetch, Pull (bấm = kiểu pull trong cài đặt, ▾ = chọn kiểu
  khác), Push, Branch, Stash, Pop và menu "Thêm". Cửa sổ hẹp thì chỉ còn biểu tượng (chú thích vẫn hiện khi rê chuột).
-->
<script lang="ts">
  import { isStatusClean, refName } from '@thaigit/core';
  import { beginCreateBranch } from '../actions/branches.ts';
  import { createPullRequest } from '../forge/createPullRequest.svelte.ts';
  import { targetOf } from '../forge/pullRequests.ts';
  import { requestWording } from '../forge/wording.ts';
  import { fetch, pull, push, sync } from '../actions/remote.ts';
  import { popLatestStash, quickStash } from '../actions/stash.ts';
  import { repoForgeItems, repoOsItems } from '../actions/menus.ts';
  import { newWindow } from '../ipc/os.ts';
  import { app } from '../stores/app.svelte.ts';
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
    onpalette?: () => void;
    /** Bật / tắt panel terminal; không truyền thì không có nút. */
    onterminal?: () => void;
    terminalVisible?: boolean;
  }

  let { store, onshowlog, onsearch, onpalette, onterminal, terminalVisible = false }: Props = $props();

  const behind = $derived(store.status.behind);
  const ahead = $derived(store.status.ahead);
  const busy = $derived(store.busy !== null);
  const forgeTarget = $derived(targetOf(store));
  const requestHead = $derived(store.currentBranchRef ? refName(store.currentBranchRef) : null);
  const wording = $derived(requestWording(forgeTarget?.provider));
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
        { title: vi.remote.syncBranch, icon: 'push', run: () => void sync(store) },
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
        onpalette && {
          title: vi.palette.open,
          icon: 'search',
          shortcut: vi.palette.shortcut,
          run: onpalette,
        },
        onsearch && { title: vi.graph.search, icon: 'search', shortcut: 'Ctrl/⌘ + F', run: onsearch },
        { title: vi.remote.refresh, icon: 'reset', run: () => store.refreshEverything() },
        { title: vi.remote.commandLog, icon: 'terminal', run: onshowlog },
        { title: vi.snapshots.open, icon: 'clock', run: () => store.timeline.open() },
        { kind: 'separator' },
        ...repoForgeItems(store),
        { kind: 'separator' },
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
    title={store.canUndoLast && store.lastUndo ? vi.remote.undoLast(store.lastUndo.title) : vi.remote.undoTip}
    disabled={busy || !store.canUndoLast}
    onclick={() => store.undoLast()}
  >
    <span class="tone undo"><Icon name="undo" size={16} /></span>
    <span class="label">{vi.remote.undo}</span>
  </button>

  <button
    type="button"
    class="action"
    title={vi.remote.fetchTip}
    disabled={busy}
    onclick={() => void fetch(store)}
  >
    <span class="tone fetch"><Icon name="fetch" size={16} /></span>
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
      <span class="tone pull"><Icon name="pull" size={16} /></span>
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
    <span class="tone push"><Icon name="push" size={16} /></span>
    <span class="label">{ahead > 0 ? vi.remote.pushAhead(ahead) : vi.remote.push}</span>
    {#if ahead > 0}<span class="badge compact">{ahead}</span>{/if}
  </button>

  {#if forgeTarget}
    <button
      type="button"
      class="action"
      title={requestHead === null ? wording.buttonNoBranch : wording.buttonTip(requestHead)}
      disabled={busy || requestHead === null}
      onclick={() => {
        if (requestHead !== null) void createPullRequest.open(store, requestHead);
      }}
    >
      <span class="tone request"><Icon name="merge" size={16} /></span>
      <span class="label">{wording.buttonLabel}</span>
    </button>
  {/if}

  <span class="gap"></span>

  <button
    type="button"
    class="action"
    title={vi.remote.branchTip}
    onclick={() => void beginCreateBranch(store)}
  >
    <span class="tone branch"><Icon name="branch" size={16} /></span>
    <span class="label">{vi.remote.branch}</span>
  </button>

  <button
    type="button"
    class="action"
    title={vi.remote.stashTip}
    disabled={isStatusClean(store.status)}
    onclick={() => void quickStash(store)}
  >
    <span class="tone stash"><Icon name="stash" size={16} /></span>
    <span class="label">{vi.remote.stash}</span>
  </button>

  <button
    type="button"
    class="action"
    title={vi.remote.popTip}
    disabled={store.stashes.length === 0}
    onclick={() => void popLatestStash(store)}
  >
    <span class="tone pop"><Icon name="archive" size={16} /></span>
    <span class="label">{vi.remote.pop}</span>
  </button>

  {#if onterminal}
    <button
      type="button"
      class="action"
      class:pressed={terminalVisible}
      title={vi.terminal.buttonTip}
      aria-pressed={terminalVisible}
      onclick={onterminal}
    >
      <span class="tone terminal"><Icon name="terminal" size={16} /></span>
      <span class="label">{vi.terminal.button}</span>
    </button>
  {/if}

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

  /* Nút như GitKraken: nền sáng, viền mảnh; màu nằm ở biểu tượng (mỗi thao tác một màu) để dễ nhận ra. */
  .action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--text) 11%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--text) 4.5%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 9%, transparent);
  }

  .action:active:not(:disabled) {
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }

  .tone {
    display: inline-grid;
    place-items: center;
  }

  .tone.undo {
    color: #8e8e93;
  }

  .tone.fetch {
    color: #0a84ff;
  }

  .tone.pull {
    color: #30b0c7;
  }

  .tone.push {
    color: #34c759;
  }

  .tone.branch {
    color: #af52de;
  }

  .tone.stash,
  .tone.pop {
    color: #ff9500;
  }

  .tone.request {
    color: #ff375f;
  }

  .tone.terminal {
    color: #5e5ce6;
  }

  .action.pressed {
    background: color-mix(in srgb, var(--text) 12%, transparent);
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
    border-left: none;
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
