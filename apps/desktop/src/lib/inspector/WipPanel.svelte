<!--
  Panel thay đổi chưa commit (port StagingView.swift): xung đột, chưa stage, đã stage — bấm file để xem diff ở vùng giữa,
  nút Stage / Bỏ stage / Huỷ khi rê chuột, nhấp đúp để stage / bỏ stage nhanh; ô soạn commit ở dưới.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    conflictAsChange,
    conflictHasMarkers,
    parseConflictFile,
    type ConflictEntry,
    type FileChange,
  } from '@thaigit/core';
  import { markResolved, resolveMany, resolveWhole } from '../actions/conflicts.ts';
  import { fileMenu } from '../actions/menus.ts';
  import { discardFiles, stageAll, stageFiles, unstageAll, unstageFiles } from '../actions/staging.ts';
  import { showBidi } from '../format/bidi.ts';
  import RiskBanner from '../risk/RiskBanner.svelte';
  import ChangeList from '../staging/ChangeList.svelte';
  import CommitComposer from '../staging/CommitComposer.svelte';
  import { vi } from '../strings.vi.ts';
  import { menus, type MenuItem } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const status = $derived(store.status);
  const conflicts = $derived<readonly FileChange[]>(status.conflicts.map((entry) => conflictAsChange(entry)));
  const total = $derived(status.staged.length + status.unstaged.length + status.conflicts.length);
  const open = $derived(store.diff.file);
  const openUnstaged = $derived(open?.source.kind === 'unstaged' ? open.change.path : null);
  const openStaged = $derived(open?.source.kind === 'staged' ? open.change.path : null);
  const openConflict = $derived(open?.source.kind === 'conflict' ? open.change.path : null);

  function resolveFor(change: FileChange, useOurs: boolean): void {
    const entry = status.conflicts.find((candidate) => candidate.path === change.path);
    if (entry) void resolveWhole(store, entry, useOurs);
  }

  /** The selected conflicting files (Ctrl/⌘-click, Shift-click) so several can be handled at once. */
  let marked = $state.raw<ReadonlySet<string>>(new Set());
  /** Number of conflict hunks per file → the "2 hunks" text next to the name. */
  let counts = $state.raw<ReadonlyMap<string, string>>(new Map());
  const conflictKey = $derived(status.conflicts.map((entry) => `${entry.kind}:${entry.path}`).join('\n'));

  $effect(() => {
    void conflictKey;
    const entries = status.conflicts.filter((entry) => conflictHasMarkers(entry.kind));
    // `untrack`: reading and then writing `marked` inside an effect would self-trigger forever.
    untrack(() => {
      marked = new Set([...marked].filter((path) => status.conflicts.some((entry) => entry.path === path)));
    });
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const entry of entries) {
        try {
          const bytes = await store.git.readWorkingFile(entry.path, 4_000_000);
          if (bytes === null) continue;
          const parsed = parseConflictFile(bytes);
          if (parsed.ok && parsed.file.blocks.length > 0) {
            next.set(entry.path, vi.branches.conflictCount(parsed.file.blocks.length));
          }
        } catch {
          // Unreadable (file too large / locked): just don't show a hunk count.
        }
      }
      if (!cancelled) counts = next;
    })();
    return () => {
      cancelled = true;
    };
  });

  const targets = $derived<readonly ConflictEntry[]>(
    marked.size === 0 ? status.conflicts : status.conflicts.filter((entry) => marked.has(entry.path)),
  );

  function bulkItems(entries: readonly ConflictEntry[]): MenuItem[] {
    const done = () => (marked = new Set());
    return [
      {
        title: entries.length > 1 ? vi.branches.useCurrentFor(entries.length) : vi.branches.useAllCurrent,
        run: () => void resolveMany(store, entries, true).then(done),
      },
      {
        title: entries.length > 1 ? vi.branches.useIncomingFor(entries.length) : vi.branches.useAllIncoming,
        run: () => void resolveMany(store, entries, false).then(done),
      },
      {
        title: vi.branches.markResolved,
        run: () =>
          void markResolved(
            store,
            entries.map((entry) => entry.path),
          ).then(done),
      },
    ];
  }

  function openConflictRow(change: FileChange, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey)) {
      const next = new Set(marked);
      if (next.has(change.path)) next.delete(change.path);
      else next.add(change.path);
      marked = next;
      return;
    }
    if (event?.shiftKey && marked.size > 0) {
      const paths = status.conflicts.map((entry) => entry.path);
      const anchor = paths.findIndex((path) => marked.has(path));
      const index = paths.indexOf(change.path);
      marked = new Set(paths.slice(Math.min(anchor, index), Math.max(anchor, index) + 1));
      return;
    }
    marked = new Set();
    store.diff.open(change, { kind: 'conflict' });
  }

  function conflictRowMenu(event: MouseEvent, change: FileChange): void {
    const group =
      marked.has(change.path) && marked.size > 1
        ? targets
        : status.conflicts.filter((entry) => entry.path === change.path);
    menus.openAt(event, [
      { title: vi.branches.openConflict, run: () => store.diff.open(change, { kind: 'conflict' }) },
      { kind: 'separator' },
      ...bulkItems(group),
    ]);
  }
</script>

<div class="wip">
  <header class="top">
    <span class="glyph"><Icon name="pencil" size={18} /></span>
    <div class="titles">
      <h2>{total === 0 ? vi.staging.clean : vi.staging.filesChanged(total)}</h2>
      {#if store.currentBranch}
        <span class="branch"><bdi>{showBidi(vi.staging.onBranch(store.currentBranch))}</bdi></span>
      {/if}
    </div>
    <button
      type="button"
      class="timeline-btn"
      title={vi.snapshots.openHint}
      aria-label={vi.snapshots.title}
      onclick={() => store.timeline.open()}
    >
      <Icon name="clock" size={14} />
      <span>{vi.snapshots.title}</span>
    </button>
  </header>

  <RiskBanner flags={store.risks.visible} ondismiss={() => store.risks.dismiss()} />

  {#if conflicts.length > 0}
    <div class="section conflicts">
      <ChangeList
        files={conflicts}
        title={vi.staging.conflictsTitle}
        actions={[
          { icon: 'checkout', title: vi.branches.useAllCurrent, run: (change) => resolveFor(change, true) },
          { icon: 'download', title: vi.branches.useAllIncoming, run: (change) => resolveFor(change, false) },
        ]}
        selectedPath={openConflict}
        markedPaths={marked}
        badges={counts}
        headerAction={{
          title: marked.size > 0 ? vi.branches.resolveSelected(marked.size) : vi.branches.resolveAll,
          tip: vi.branches.resolveAllTip,
          icon: 'check-circle',
          run: (event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLElement)
              menus.openBelow(target, bulkItems(targets), { focusFirst: event.detail === 0 });
          },
        }}
        onopen={openConflictRow}
        onmenu={conflictRowMenu}
      />
    </div>
  {/if}

  <!-- Danh sách đang trống thu nhỏ để danh sách kia hiện được nhiều file hơn (như GitKraken). -->
  <div class="section" class:compact={status.unstaged.length === 0 && status.staged.length > 0}>
    <ChangeList
      files={status.unstaged}
      title={vi.staging.unstagedTitle}
      dragFrom="unstaged"
      dropZone="unstaged"
      headerAction={{ title: vi.staging.stageAll, icon: 'stage', run: () => void stageAll(store) }}
      folderAction={{
        title: vi.staging.stageFolder,
        icon: 'stage',
        run: (changes) => void stageFiles(store, changes),
      }}
      actions={[
        {
          icon: 'discard',
          title: vi.staging.discardFile,
          destructive: true,
          run: (change) => void discardFiles(store, [change]),
        },
        { icon: 'stage', title: vi.staging.stageFile, run: (change) => void stageFiles(store, [change]) },
      ]}
      selectedPath={openUnstaged}
      emptyText={vi.staging.noUnstaged}
      onopen={(change) => store.diff.open(change, { kind: 'unstaged' })}
      onprimary={(change) => void stageFiles(store, [change])}
      onmenu={(event, change) => menus.openAt(event, fileMenu(store, change, { kind: 'unstaged' }))}
    />
  </div>

  <div class="section" class:compact={status.staged.length === 0}>
    <ChangeList
      files={status.staged}
      title={vi.staging.stagedTitle}
      dragFrom="staged"
      dropZone="staged"
      headerAction={{ title: vi.staging.unstageAll, icon: 'unstage', run: () => void unstageAll(store) }}
      folderAction={{
        title: vi.staging.unstageFolder,
        icon: 'unstage',
        run: (changes) => void unstageFiles(store, changes),
      }}
      actions={[
        {
          icon: 'unstage',
          title: vi.staging.unstageFile,
          run: (change) => void unstageFiles(store, [change]),
        },
      ]}
      selectedPath={openStaged}
      emptyText={vi.staging.noStaged}
      onopen={(change) => store.diff.open(change, { kind: 'staged' })}
      onprimary={(change) => void unstageFiles(store, [change])}
      onmenu={(event, change) => menus.openAt(event, fileMenu(store, change, { kind: 'staged' }))}
    />
  </div>

  <CommitComposer {store} />
</div>

<style>
  .wip {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 14px 14px 10px;
  }

  .glyph {
    color: var(--text-secondary);
  }

  .titles {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .timeline-btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .timeline-btn :global(svg) {
    color: var(--accent);
  }

  .timeline-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .branch {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section {
    display: flex;
    flex: 1 1 0;
    min-height: 90px;
  }

  .section.compact {
    flex: 0 0 auto;
    min-height: 0;
    max-height: 110px;
  }

  .section.conflicts {
    flex: 0 1 auto;
    max-height: 30%;
  }
</style>
