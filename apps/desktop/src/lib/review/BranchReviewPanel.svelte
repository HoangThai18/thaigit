<!--
  Panel review một nhánh so với nhánh khác (bên phải, thay chi tiết commit): danh sách file thay đổi của nhánh kể từ điểm tách khỏi
  nhánh kia. Bấm file để xem diff ở vùng giữa. Tên nhánh chỉ được render dạng chữ — không {@html}.
-->
<script lang="ts">
  import { refName } from '@thaigit/core';
  import { fileMenu } from '../actions/menus.ts';
  import { showBidi } from '../format/bidi.ts';
  import FileList from '../inspector/FileList.svelte';
  import { menus } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const text = vi.branches;
  const review = $derived(store.branchReview);
  const head = $derived(review.head);
  const base = $derived(review.base);
</script>

{#if head && base}
  <div class="review">
    <div class="top">
      <div class="heading">
        <span class="kind">{text.reviewHeading}</span>
        <button
          type="button"
          class="icon-btn"
          title={text.reviewRefresh}
          aria-label={text.reviewRefresh}
          disabled={review.phase === 'loading'}
          onclick={() => void review.load()}
        >
          <Icon name="fetch" size={13} />
        </button>
        <button
          type="button"
          class="icon-btn"
          title={text.reviewClose}
          aria-label={text.reviewClose}
          onclick={() => review.close()}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <p class="branches selectable">
        <code><bdi>{showBidi(refName(head))}</bdi></code>
        <span class="vs">{text.reviewVersus}</span>
        <button
          type="button"
          class="base"
          title={text.reviewChangeBase}
          aria-label={`${text.reviewChangeBase}: ${refName(base)}`}
          onclick={() => review.pickBase(head)}
        >
          <code><bdi>{showBidi(refName(base))}</bdi></code>
          <Icon name="chevron-down" size={11} />
        </button>
      </p>
    </div>
    {#if review.phase === 'loading'}
      <div class="placeholder" role="status">
        <Icon name="spinner" size={14} />
        <span>{text.reviewLoading}</span>
      </div>
    {:else if review.phase === 'failed' || review.changes === null}
      <div class="placeholder" role="alert">
        <span>{text.reviewFailed}</span>
        <button type="button" class="btn" onclick={() => void review.load()}>
          <Icon name="fetch" size={13} />
          <span>{text.reviewRetry}</span>
        </button>
      </div>
    {:else}
      <FileList
        files={review.changes.files}
        title={text.reviewFiles(review.changes.files.length, refName(base))}
        emptyText={text.reviewNoFiles(refName(base))}
        selectedPath={review.openPath}
        onopen={(change) => review.openFile(change)}
        onmenu={(event, change) => {
          const source = review.diffSource();
          if (source !== null) menus.openAt(event, fileMenu(store, change, source));
        }}
      />
    {/if}
  </div>
{/if}

<style>
  .review {
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
    gap: 4px;
    min-width: 0;
  }

  .kind {
    flex: 1 1 auto;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text-secondary);
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--text);
  }

  .icon-btn:disabled {
    opacity: 0.5;
  }

  .branches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .base {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px 0 0;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text-secondary);
    font: inherit;
  }

  .base:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  code {
    padding: 1px 6px;
    border-radius: var(--radius-s);
    background: var(--chip-fill);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .btn:focus-visible,
  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .placeholder {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
