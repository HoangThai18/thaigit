<!--
  Nút nhánh hiện tại trên thanh công cụ (port BranchSwitcher.swift): bấm để đổi nhanh sang nhánh local gần đây hoặc tạo
  nhánh mới. Repo có hàng trăm nhánh thì menu chỉ liệt kê 15 nhánh gần nhất; còn lại tìm bằng "Tìm & chuyển nhánh…"
  (Ctrl/⌘ + B, BranchPicker.svelte).
-->
<script lang="ts">
  import { refName } from '@thaigit/core';
  import { beginCreateBranch, checkout } from '../actions/branches.ts';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import { menus, type MenuItem } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
    /** Open the find & switch branch box. */
    onfind?: () => void;
  }

  let { store, onfind }: Props = $props();

  const RECENT_LIMIT = 15;
  let button = $state<HTMLButtonElement | null>(null);

  const detached = $derived(store.status.head.kind === 'detached');
  const headLane = $derived(detached ? 'var(--warning)' : 'var(--success)');

  function open(event: MouseEvent): void {
    if (!button) return;
    const branches = store.recentLocalBranches(RECENT_LIMIT);
    const items: MenuItem[] = [
      {
        kind: 'header',
        title:
          branches.length < store.localBranches.length ? vi.remote.recentBranches : vi.remote.localBranches,
      },
    ];
    if (branches.length === 0) {
      items.push({ title: vi.remote.noBranches, disabled: true, run: () => {} });
    }
    for (const ref of branches) {
      items.push({
        title: showBidi(refName(ref)),
        checked: ref.isHead,
        icon: 'branch',
        run: () => void checkout(store, ref),
      });
    }
    items.push({ kind: 'separator' });
    if (onfind) {
      items.push({
        title: vi.branches.pickerOpen,
        icon: 'search',
        shortcut: vi.branches.pickerShortcut,
        run: onfind,
      });
    }
    items.push({ title: vi.remote.newBranchHere, icon: 'plus', run: () => void beginCreateBranch(store) });
    menus.openBelow(button, items, { focusFirst: event.detail === 0 });
  }
</script>

<button
  type="button"
  class="branch"
  style:--head-lane={headLane}
  title={vi.remote.switchBranchTip}
  aria-haspopup="menu"
  bind:this={button}
  onclick={open}
>
  <span class="head-dot"><Icon name={detached ? 'warning' : 'check'} size={10} strokeWidth={3.2} /></span>
  <span class="labels">
    <span class="caption">{detached ? vi.remote.detachedCaption : vi.remote.currentBranchCaption}</span>
    <span class="branch-name"><bdi>{showBidi(store.headDescription || vi.window.noBranch)}</bdi></span>
  </span>
  <Icon name="chevron-down" size={11} />
</button>

<style>
  .branch {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    gap: 8px;
    max-width: 280px;
    height: 34px;
    padding: 0 10px 0 7px;
    border: 1px solid color-mix(in srgb, var(--head-lane) 55%, transparent);
    border-radius: 17px;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--head-lane) 20%, var(--glass-fill)),
      color-mix(in srgb, var(--head-lane) 12%, var(--glass-fill))
    );
    box-shadow: 0 2px 10px -4px var(--head-lane);
    color: var(--text-secondary);
    font: inherit;
  }

  .branch:hover {
    background: color-mix(in srgb, var(--head-lane) 26%, var(--glass-fill));
  }

  .branch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .head-dot {
    display: grid;
    flex: none;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--head-lane);
    color: #fff;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--head-lane) 25%, transparent);
  }

  .labels {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.15;
    text-align: left;
  }

  .caption {
    color: color-mix(in srgb, var(--head-lane) 70%, var(--text-secondary));
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
  }
</style>
