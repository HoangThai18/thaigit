<!-- Panel chi tiết bên phải: chọn theo `store.selection` (commit / stash / WIP / chưa chọn). -->
<script lang="ts">
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import CommitDetail from './CommitDetail.svelte';
  import StashDetail from './StashDetail.svelte';
  import WipPanel from './WipPanel.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const selection = $derived(store.selection);
</script>

<div class="inspector" role="region" aria-label={vi.inspector.ariaLabel}>
  {#if selection.kind === 'workingTree'}
    <WipPanel {store} />
  {:else if selection.kind === 'commit'}
    {#key selection.sha}
      <CommitDetail {store} sha={selection.sha} />
    {/key}
  {:else if selection.kind === 'stash'}
    {#key selection.sha}
      <StashDetail {store} sha={selection.sha} />
    {/key}
  {:else}
    <div class="empty">
      <strong>{vi.inspector.emptyTitle}</strong>
      <span>{vi.inspector.emptyHint}</span>
    </div>
  {/if}
</div>

<style>
  .inspector {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    padding: 32px;
    color: var(--text-secondary);
    text-align: center;
  }

  .empty strong {
    color: var(--text);
    font-size: 15px;
  }
</style>
