<!--
  Sidebar: LOCAL / REMOTE / TAGS / STASHES (port SidebarView.swift). Bấm một nhánh/tag → chọn commit của nó trên graph; bấm stash →
  xem chi tiết stash. Component KHÔNG đọc `status`/`selection` trong phần dựng (chỉ một $effect nhỏ đồng bộ vùng chọn), nên
  đổi file hay đổi commit đang chọn không dựng lại cả danh sách nhánh.
-->
<script lang="ts">
  import {
    refName,
    refRemoteName,
    refShortBranchName,
    stashDisplayMessage,
    isAnnotatedTag,
    type GitRef,
    type Remote,
    type Stash,
  } from '@thaigit/core';
  import { untrack } from 'svelte';
  import { containsFolded, foldText } from '../format/natural.ts';
  import { formatAbsolute } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import BranchTree from './BranchTree.svelte';
  import LimitedRows from './LimitedRows.svelte';
  import './sidebar.css';
  import { buildBranchTree } from './tree.ts';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  let filter = $state('');
  let selectedId = $state<string | null>(null);
  /** Remote đang mở (mặc định đóng; khi đang lọc thì mở hết). */
  let remoteOpen = $state<Record<string, boolean>>({});

  const query = $derived(foldText(filter.trim()));
  const filtering = $derived(query !== '');
  const sections = $derived(prefs.value.sidebarSections);

  function toggle(section: keyof typeof sections): void {
    prefs.update({ sidebarSections: { ...sections, [section]: !sections[section] } });
  }

  const matches = (text: string): boolean => containsFolded(text, query);

  // --- dữ liệu từng mục (chỉ tính khi mục đang mở) ---
  const locals = $derived(
    sections.local
      ? filtering
        ? store.localBranches.filter((ref) => matches(refName(ref)))
        : store.localBranches
      : [],
  );
  const localTree = $derived(
    sections.local && !filtering ? buildBranchTree(store.localBranches, refName) : [],
  );
  const tagList = $derived(
    sections.tags ? (filtering ? store.tags.filter((ref) => matches(refName(ref))) : store.tags) : [],
  );

  function remoteBranches(remote: Remote): GitRef[] {
    return store.remoteBranches.filter(
      (ref) => refRemoteName(ref) === remote.name && matches(refShortBranchName(ref)),
    );
  }

  // --- chọn ---
  function selectRef(ref: GitRef): void {
    selectedId = `ref:${ref.fullName}`;
    store.revealRef(ref);
  }

  function selectStash(stash: Stash): void {
    selectedId = `stash:${stash.sha}`;
    store.select({ kind: 'stash', sha: stash.sha });
  }

  // Bỏ chọn ở sidebar khi người dùng chọn commit/stash khác trên graph (như SidebarSelectionSync của Swift).
  $effect(() => {
    const selection = store.selection;
    const current = untrack(() => selectedId);
    if (current === null) return;
    if (current.startsWith('ref:')) {
      const ref = store.findRef(current.slice('ref:'.length));
      if (!(selection.kind === 'commit' && ref !== undefined && ref.target === selection.sha))
        selectedId = null;
    } else if (current.startsWith('stash:')) {
      if (!(selection.kind === 'stash' && current === `stash:${selection.sha}`)) selectedId = null;
    }
  });
</script>

{#snippet sectionHeader(
  key: keyof typeof sections,
  title: string,
  count: number,
  icon: 'laptop' | 'cloud' | 'tag' | 'archive',
)}
  <button
    type="button"
    class="section-header"
    aria-expanded={sections[key]}
    title={vi.sidebar.section(title)}
    onclick={() => toggle(key)}
  >
    <span class="sh-icon"><Icon name={icon} size={14} /></span>
    <span class="sh-title">{title}</span>
    <span class="sb-count">{count}</span>
    <span class="sh-chevron"
      ><Icon name={sections[key] ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} /></span
    >
  </button>
{/snippet}

{#snippet branchRow(ref: GitRef, title: string, depth: number)}
  {@const current = ref.kind === 'localBranch' && ref.isHead}
  <button
    type="button"
    class="sb-row"
    class:selected={selectedId === `ref:${ref.fullName}`}
    style:padding-left="{10 + depth * 14}px"
    title={ref.upstream ? `${refName(ref)} → ${ref.upstream}` : refName(ref)}
    onclick={() => selectRef(ref)}
  >
    <span class="sb-icon">
      {#if current}
        <span class="badge"><Icon name="check" size={10} strokeWidth={3.2} /></span>
      {:else}
        <Icon name={ref.kind === 'remoteBranch' ? 'cloud' : 'branch'} size={15} />
      {/if}
    </span>
    <span class="sb-title" class:current>{title}</span>
    {#if ref.upstreamGone}
      <span class="gone" title={vi.sidebar.upstreamGone}><Icon name="warning" size={13} /></span>
    {/if}
    {#if ref.ahead > 0}
      <span class="ahead" title={vi.sidebar.aheadTip(ref.ahead)}>↑{ref.ahead}</span>
    {/if}
    {#if ref.behind > 0}
      <span class="behind" title={vi.sidebar.behindTip(ref.behind)}>↓{ref.behind}</span>
    {/if}
  </button>
{/snippet}

<div class="sidebar" role="navigation" aria-label={vi.sidebar.ariaLabel}>
  <div class="filter">
    <span class="filter-icon"><Icon name="filter" size={14} /></span>
    <input
      type="text"
      placeholder={vi.sidebar.filterPlaceholder}
      bind:value={filter}
      spellcheck="false"
      autocomplete="off"
      aria-label={vi.sidebar.filterPlaceholder}
    />
    {#if filtering}
      <button
        type="button"
        class="filter-clear"
        title={vi.sidebar.filterClear}
        aria-label={vi.sidebar.filterClear}
        onclick={() => (filter = '')}
      >
        <Icon name="x" size={12} strokeWidth={2.4} />
      </button>
    {/if}
  </div>

  <div class="scroll">
    <!-- LOCAL -->
    <section>
      {@render sectionHeader('local', vi.sidebar.local, store.localBranches.length, 'laptop')}
      {#if sections.local}
        {#if locals.length === 0}
          <p class="placeholder">{filtering ? vi.sidebar.noLocalMatch : vi.sidebar.noLocal}</p>
        {:else if filtering}
          <LimitedRows items={locals} noun={vi.sidebar.nounBranch} keyOf={(ref) => ref.fullName}>
            {#snippet row(ref: GitRef)}
              {@render branchRow(ref, refName(ref), 0)}
            {/snippet}
          </LimitedRows>
        {:else}
          <BranchTree nodes={localTree} leaf={branchRow} />
        {/if}
      {/if}
    </section>

    <!-- REMOTE -->
    <section>
      {@render sectionHeader('remote', vi.sidebar.remote, store.remoteBranches.length, 'cloud')}
      {#if sections.remote}
        {#if store.remotes.length === 0}
          <p class="placeholder">{vi.sidebar.noRemote}</p>
        {/if}
        {#each store.remotes as remote (remote.name)}
          {@const open = filtering || (remoteOpen[remote.name] ?? false)}
          <button
            type="button"
            class="sb-row"
            aria-expanded={open}
            title={remote.fetchUrl}
            onclick={() => (remoteOpen[remote.name] = !open)}
          >
            <span class="sb-chevron"
              ><Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} /></span
            >
            <span class="sb-icon"><Icon name="cloud" size={15} /></span>
            <span class="sb-title">{remote.name}</span>
          </button>
          {#if open}
            {@const branches = remoteBranches(remote)}
            {#if filtering}
              <LimitedRows
                items={branches}
                noun={vi.sidebar.nounBranch}
                keyOf={(ref) => ref.fullName}
                indent={24}
              >
                {#snippet row(ref: GitRef)}
                  {@render branchRow(ref, refShortBranchName(ref), 1)}
                {/snippet}
              </LimitedRows>
            {:else}
              <BranchTree nodes={buildBranchTree(branches, refShortBranchName)} depth={1} leaf={branchRow} />
            {/if}
          {/if}
        {/each}
      {/if}
    </section>

    <!-- TAGS -->
    <section>
      {@render sectionHeader('tags', vi.sidebar.tags, store.tags.length, 'tag')}
      {#if sections.tags}
        {#if tagList.length === 0}
          <p class="placeholder">{filtering ? vi.sidebar.noTagsMatch : vi.sidebar.noTags}</p>
        {:else}
          <LimitedRows items={tagList} noun={vi.sidebar.nounTag} keyOf={(ref) => ref.fullName}>
            {#snippet row(ref: GitRef)}
              <button
                type="button"
                class="sb-row"
                class:selected={selectedId === `ref:${ref.fullName}`}
                title={isAnnotatedTag(ref) ? vi.sidebar.annotatedTag : vi.sidebar.tag}
                onclick={() => selectRef(ref)}
              >
                <span class="sb-icon"><Icon name="tag" size={15} /></span>
                <span class="sb-title">{refName(ref)}</span>
              </button>
            {/snippet}
          </LimitedRows>
        {/if}
      {/if}
    </section>

    <!-- STASHES -->
    <section>
      {@render sectionHeader('stashes', vi.sidebar.stashes, store.stashes.length, 'archive')}
      {#if sections.stashes}
        {#if store.stashes.length === 0}
          <p class="placeholder">{vi.sidebar.noStashes}</p>
        {:else}
          <LimitedRows items={store.stashes} noun={vi.sidebar.nounStash} keyOf={(stash) => stash.sha}>
            {#snippet row(stash: Stash)}
              {@const message = stashDisplayMessage(stash)}
              <button
                type="button"
                class="sb-row"
                class:selected={selectedId === `stash:${stash.sha}`}
                title={[stash.message, formatAbsolute(stash.date)].join('\n')}
                onclick={() => selectStash(stash)}
              >
                <span class="sb-icon"><Icon name="archive" size={15} /></span>
                <span class="sb-title">{message === '' ? stash.selector : message}</span>
              </button>
            {/snippet}
          </LimitedRows>
        {/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin: 8px 10px;
    padding: 0 10px;
    height: 30px;
    border-radius: 15px;
    background: var(--field-fill);
    border: 1px solid var(--field-border);
  }

  .filter:focus-within {
    border-color: var(--accent);
  }

  .filter-icon {
    color: var(--text-secondary);
    display: grid;
  }

  .filter input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: 13px;
    user-select: text;
    -webkit-user-select: text;
  }

  .filter input::placeholder {
    color: var(--text-tertiary);
  }

  .filter-clear {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 9px;
    background: var(--chip-fill);
    color: var(--text-secondary);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 12px;
  }

  section {
    margin-bottom: 6px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding: 0 8px 0 10px;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .sh-icon {
    display: grid;
    flex: none;
    width: 16px;
  }

  .sh-title {
    flex: none;
  }

  .sh-chevron {
    margin-left: auto;
    display: grid;
    color: var(--text-tertiary);
  }

  .placeholder {
    margin: 2px 10px 6px 34px;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
  }

  .gone {
    flex: none;
    display: grid;
    color: var(--warning);
  }

  .ahead,
  .behind {
    flex: none;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .ahead {
    color: var(--text-secondary);
  }

  .behind {
    color: var(--warning);
  }
</style>
