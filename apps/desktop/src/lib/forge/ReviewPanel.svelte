<!--
  Panel review một Pull Request / Merge Request (bên phải, thay chi tiết commit): tiêu đề, người mở, nhánh, mô tả và danh sách file
  thay đổi so với điểm tách khỏi nhánh đích. Bấm file để xem diff ở vùng giữa. Mọi chữ từ máy chủ (tiêu đề, mô tả, tên người, tên
  nhánh) chỉ được render dạng chữ — không {@html}.
-->
<script lang="ts">
  import { fileMenu } from '../actions/menus.ts';
  import { showBidi } from '../format/bidi.ts';
  import { formatRelative } from '../format/time.ts';
  import Avatar from '../inspector/Avatar.svelte';
  import FileList from '../inspector/FileList.svelte';
  import { openUrl } from '../ipc/os.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import { checkoutPullRequest } from './checkoutPullRequest.ts';
  import { openReview } from './openReview.ts';
  import { pullRequestCheckout, requestStateLabel, targetOf } from './pullRequests.ts';
  import ReviewPeople from './ReviewPeople.svelte';
  import { requestWording } from './wording.ts';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const text = vi.pullRequests;
  const review = $derived(store.review);
  const request = $derived(review.request);
  const wording = $derived(requestWording(review.provider));
  const label = $derived(request ? requestStateLabel(request) : '');
  const reference = $derived(request ? wording.reviewRef(request.number) : '');
  const body = $derived(request?.body.trim() ?? '');
  const isLongBody = $derived(body.length > 280 || (body.match(/\n/g)?.length ?? 0) > 6);
  const updated = $derived.by(() => {
    const seconds = request ? Date.parse(request.updatedAt) / 1000 : Number.NaN;
    return Number.isFinite(seconds) ? text.reviewUpdated(formatRelative(seconds)) : '';
  });
  const canCheckout = $derived.by(() => {
    const target = targetOf(store);
    return (
      request !== null &&
      target !== null &&
      pullRequestCheckout(request, target.provider, target.owner, target.remote) !== null
    );
  });

  /** Bitbucket chưa gán người được từ app (chỉ hiện danh sách người review). */
  const editablePeople = $derived(review.provider === 'github' || review.provider === 'gitlab');

  let showFullBody = $state(false);
</script>

{#if request}
  <div class="review">
    <div class="top">
      <div class="heading">
        <span class="kind">{wording.reviewHeading(request.number)}</span>
        {#if label}<span class="tag">{label}</span>{/if}
        <button
          type="button"
          class="icon-btn close"
          title={text.reviewClose}
          aria-label={text.reviewClose}
          onclick={() => review.close()}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <h2 class="summary selectable"><bdi>{showBidi(request.title)}</bdi></h2>
      <div class="author">
        <Avatar name={request.author} size={28} />
        <div class="who">
          <span class="name selectable"><bdi>{showBidi(request.author)}</bdi></span>
          <span class="when">
            {[updated, request.commits === null ? '' : text.reviewCommits(request.commits)]
              .filter((part) => part !== '')
              .join(' · ')}
          </span>
        </div>
      </div>
      <p class="branches selectable">
        <code><bdi>{showBidi(request.sourceBranch)}</bdi></code>
        <span aria-hidden="true">→</span>
        <code><bdi>{showBidi(request.targetBranch)}</bdi></code>
      </p>
      {#if body}
        <p class="body selectable" class:full={showFullBody && isLongBody}><bdi>{showBidi(body)}</bdi></p>
        {#if isLongBody}
          <button type="button" class="link" onclick={() => (showFullBody = !showFullBody)}>
            {showFullBody ? vi.inspector.collapseBody : vi.inspector.showFullBody}
          </button>
        {/if}
      {:else}
        <p class="body none">{text.reviewNoDescription}</p>
      {/if}
      <ReviewPeople {store} role="reviewers" editable={editablePeople} />
      {#if review.provider !== 'bitbucket'}
        <ReviewPeople {store} role="assignees" editable={editablePeople} />
      {/if}
      <div class="buttons">
        <button type="button" class="btn" onclick={() => void openUrl(request.webUrl, true)}>
          <Icon name="globe" size={13} />
          <span>{text.openOnWeb}</span>
        </button>
        <button
          type="button"
          class="btn"
          disabled={!canCheckout}
          onclick={() => void checkoutPullRequest(store, request)}
        >
          <Icon name="checkout" size={13} />
          <span>{text.checkout}</span>
        </button>
        <button
          type="button"
          class="btn"
          disabled={review.phase === 'loading'}
          onclick={() => void openReview(store, request)}
        >
          <Icon name="fetch" size={13} />
          <span>{text.refresh}</span>
        </button>
      </div>
    </div>
    {#if review.phase === 'loading'}
      <div class="placeholder" role="status">
        <Icon name="spinner" size={14} />
        <span>{text.reviewLoading}</span>
      </div>
    {:else if review.phase === 'failed' || review.changes === null}
      <div class="placeholder" role="alert">
        <span>{text.reviewFailed}</span>
        <button type="button" class="btn" onclick={() => void openReview(store, request)}>
          <Icon name="fetch" size={13} />
          <span>{text.reviewRetry}</span>
        </button>
      </div>
    {:else}
      <FileList
        files={review.changes.files}
        title={text.reviewFiles(review.changes.files.length)}
        emptyText={text.reviewNoFiles}
        selectedPath={review.openPath}
        onopen={(change) => review.openFile(change, reference)}
        onmenu={(event, change) => {
          const source = review.diffSource(reference);
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
    max-height: 62%;
    overflow-y: auto;
  }

  .heading {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .kind {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--chip-fill);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .close {
    margin-left: auto;
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

  .icon-btn:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .summary {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .author {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: 13px;
    font-weight: 600;
  }

  .when {
    color: var(--text-secondary);
    font-size: 12px;
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

  code {
    padding: 1px 6px;
    border-radius: var(--radius-s);
    background: var(--chip-fill);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .body {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body.full {
    display: block;
    max-height: 260px;
    overflow-y: auto;
  }

  .body.none {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .link {
    align-self: flex-start;
    margin-top: -4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn:focus-visible,
  .icon-btn:focus-visible,
  .link:focus-visible {
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
