<!-- Chi tiết stash (port StashDetailView): lời nhắn, nhánh gốc, thời điểm và file thay đổi. Apply/Pop/Xoá ở bản sau (ghi). -->
<script lang="ts">
  import { stashBranchName, stashDisplayMessage } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { formatAbsolute } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import FileList from './FileList.svelte';
  import { fileMenu } from '../actions/menus.ts';
  import { menus } from '../stores/menus.svelte.ts';

  interface Props {
    store: RepoStore;
    sha: string;
  }

  let { store, sha }: Props = $props();

  const stash = $derived(store.stashes.find((candidate) => candidate.sha === sha));
  const message = $derived(stash ? stashDisplayMessage(stash) : '');
  const branch = $derived(stash ? stashBranchName(stash) : null);
  const details = $derived(store.details?.commit.id === sha ? store.details : null);
  const openPath = $derived.by(() => {
    const open = store.diff.file;
    return open?.source.kind === 'stash' && open.source.sha === sha ? open.change.path : null;
  });
</script>

{#if stash}
  <div class="detail">
    <div class="top">
      <div class="heading">
        <span class="glyph"><Icon name="archive" size={16} /></span>
        <h2>{vi.inspector.stash}</h2>
        <code class="selector selectable">{stash.selector}</code>
      </div>
      <p class="message selectable">
        <bdi>{showBidi(message === '' ? vi.sidebar.stashNoMessage : message)}</bdi>
      </p>
      <p class="meta">
        <bdi
          >{showBidi(
            [branch === null ? null : vi.inspector.stashFromBranch(branch), formatAbsolute(stash.date)]
              .filter((part) => part !== null)
              .join(' · '),
          )}</bdi
        >
      </p>
      <p class="note">{vi.inspector.stashActionsLater}</p>
    </div>
    {#if details}
      <FileList
        files={details.files}
        title={vi.inspector.filesChanged(details.files.length)}
        emptyText={vi.inspector.noFiles}
        selectedPath={openPath}
        onopen={(change) => store.diff.open(change, { kind: 'stash', sha })}
        onmenu={(event, change) => menus.openAt(event, fileMenu(store, change, { kind: 'stash', sha }))}
      />
    {:else}
      <div class="loading" role="status">{vi.inspector.loadingDetails}</div>
    {/if}
  </div>
{:else}
  <div class="loading">{vi.inspector.stashMissing}</div>
{/if}

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .top {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }

  .heading {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .glyph {
    display: grid;
    color: var(--text-secondary);
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  .selector {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .message {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .meta,
  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .note {
    color: var(--text-tertiary);
  }

  .loading {
    display: grid;
    place-items: center;
    flex: 1;
    padding: 24px;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
