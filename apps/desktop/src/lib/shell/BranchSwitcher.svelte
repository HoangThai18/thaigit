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
    /** Mở hộp tìm & chuyển nhánh. */
    onfind?: () => void;
  }

  let { store, onfind }: Props = $props();

  const RECENT_LIMIT = 15;
  let button = $state<HTMLButtonElement | null>(null);

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
  title={vi.remote.switchBranchTip}
  aria-haspopup="menu"
  bind:this={button}
  onclick={open}
>
  <Icon name="branch" size={15} />
  <span class="branch-name"><bdi>{showBidi(store.headDescription || vi.window.noBranch)}</bdi></span>
  <Icon name="chevron-down" size={11} />
</button>

<style>
  .branch {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 7px;
    max-width: 260px;
    height: 30px;
    padding: 0 10px 0 12px;
    border: 1px solid var(--glass-rim);
    border-radius: 15px;
    background: var(--glass-fill);
    color: var(--text-secondary);
    font: inherit;
  }

  .branch:hover {
    background: var(--row-hover);
  }

  .branch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: 13px;
  }
</style>
