<!--
  Chi tiết commit (port CommitDetailView.swift): tóm tắt, mô tả (rút gọn + "Xem toàn bộ"), tác giả/committer, SHA copy được, cha bấm
  được, danh sách file thay đổi. Mọi chuỗi từ repo (tóm tắt, mô tả, tên, email) chỉ được render dạng chữ — không {@html}.
-->
<script lang="ts">
  import { commitBody, commitSummary } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { formatAbsolute, formatRelative } from '../format/time.ts';
  import { vi } from '../strings.vi.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import Avatar from './Avatar.svelte';
  import FileList from './FileList.svelte';
  import { fileMenu } from '../actions/menus.ts';
  import { explainCommit } from '../ai/actions.ts';
  import { AI_ENABLED } from '../ai/enabled.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { stageAll } from '../actions/staging.ts';

  interface Props {
    store: RepoStore;
    sha: string;
  }

  let { store, sha }: Props = $props();

  const details = $derived(store.details?.commit.id === sha ? store.details : null);
  const openPath = $derived.by(() => {
    const open = store.diff.file;
    return open?.source.kind === 'commit' && open.source.sha === sha ? open.change.path : null;
  });
  const commit = $derived(details?.commit);
  const summary = $derived(details ? commitSummary(details.message, details.commit.subject) : '');
  const body = $derived(details ? commitBody(details.message) : '');
  const isLongBody = $derived(body.length > 280 || (body.match(/\n/g)?.length ?? 0) > 6);
  const differentCommitter = $derived(
    commit !== undefined &&
      (commit.committerName !== commit.authorName || commit.committerEmail !== commit.authorEmail),
  );

  let showFullBody = $state(false);
  /** Viewing a commit while there are still uncommitted files: remind at the top of the panel (like GitKraken's WIP line). */
  const uncommitted = $derived(
    new Set([
      ...store.status.staged.map((change) => change.path),
      ...store.status.unstaged.map((change) => change.path),
      ...store.status.conflicts.map((entry) => entry.path),
    ]).size,
  );
</script>

{#if details && commit}
  <div class="detail">
    {#if uncommitted > 0}
      <div class="uncommitted" role="status">
        <div class="line">
          <Icon name={store.status.conflicts.length > 0 ? 'warning' : 'pencil'} size={14} />
          <strong>{vi.inspector.uncommittedBanner(uncommitted)}</strong>
          {#if store.currentBranch}
            <span class="on"><bdi>{showBidi(vi.inspector.uncommittedOn(store.currentBranch))}</bdi></span>
          {/if}
        </div>
        <div class="buttons">
          {#if store.status.unstaged.length > 0}
            <button type="button" class="btn" onclick={() => void stageAll(store)}>
              <Icon name="stage" size={13} />
              <span>{vi.inspector.uncommittedStageAll}</span>
            </button>
          {/if}
          <button
            type="button"
            class="btn primary"
            title={vi.inspector.uncommittedReviewTip}
            onclick={() => store.select({ kind: 'workingTree' }, true)}
          >
            <Icon name="commit" size={13} />
            <span>{vi.inspector.uncommittedReview}</span>
          </button>
        </div>
      </div>
    {/if}
    <div class="top">
      <h2 class="summary selectable"><bdi>{showBidi(summary)}</bdi></h2>
      {#if body}
        <p class="body selectable" class:full={showFullBody && isLongBody}><bdi>{showBidi(body)}</bdi></p>
        {#if isLongBody}
          <button type="button" class="link" onclick={() => (showFullBody = !showFullBody)}>
            {showFullBody ? vi.inspector.collapseBody : vi.inspector.showFullBody}
          </button>
        {/if}
      {/if}

      <div class="author">
        <Avatar name={commit.authorName} size={32} />
        <div class="who">
          <span class="name selectable"><bdi>{showBidi(commit.authorName)}</bdi></span>
          <span class="email selectable"><bdi>{showBidi(commit.authorEmail)}</bdi></span>
        </div>
        <div class="when">
          <span>{formatAbsolute(commit.authorDate)}</span>
          <span class="rel">{formatRelative(commit.authorDate)}</span>
        </div>
      </div>
      {#if differentCommitter}
        <p class="committer selectable">
          <bdi
            >{showBidi(
              vi.inspector.committedBy(commit.committerName, formatAbsolute(commit.commitDate)),
            )}</bdi
          >
        </p>
      {/if}

      <dl class="ids">
        <dt>{vi.inspector.commit}</dt>
        <dd>
          <code class="selectable">{commit.id.slice(0, 12)}</code>
          <button
            type="button"
            class="icon-btn"
            title={vi.inspector.copySha}
            aria-label={vi.inspector.copySha}
            onclick={() => store.copy(commit.id, 'SHA')}
          >
            <Icon name="copy" size={13} />
          </button>
        </dd>
        {#if commit.parents.length > 0}
          <dt>{vi.inspector.parent}</dt>
          <dd>
            <!-- Khoá theo vị trí: git cho phép một commit liệt kê cùng một cha hai lần (`hash-object`, repo hỏng). -->
            {#each commit.parents as parent, index (index)}
              <button
                type="button"
                class="sha-link"
                title={vi.inspector.parentTip}
                onclick={() => store.reveal(parent)}
              >
                {parent.slice(0, 7)}
              </button>
            {/each}
          </dd>
        {/if}
      </dl>
      {#if AI_ENABLED}
        <button
          type="button"
          class="ai-explain"
          title={vi.ai.explainTip}
          onclick={() => explainCommit(store, commit)}
        >
          <Icon name="sparkles" size={13} />
          <span>{vi.ai.explain}</span>
        </button>
      {/if}
    </div>
    <FileList
      files={details.files}
      title={vi.inspector.filesChanged(details.files.length)}
      emptyText={vi.inspector.noFiles}
      selectedPath={openPath}
      onopen={(change) =>
        store.diff.open(change, { kind: 'commit', sha, parent: details.commit.parents[0] ?? null })}
      onmenu={(event, change) =>
        menus.openAt(
          event,
          fileMenu(store, change, { kind: 'commit', sha, parent: details.commit.parents[0] ?? null }),
        )}
    />
  </div>
{:else if store.isLoadingDetails}
  <div class="placeholder" role="status">{vi.inspector.loadingDetails}</div>
{:else}
  <div class="placeholder">{vi.inspector.noDetails}</div>
{/if}

<style>
  .uncommitted {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 10px 12px 0;
    padding: 10px;
    border-radius: var(--radius-m);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    font-size: 12.5px;
  }

  .uncommitted .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .uncommitted .line :global(svg) {
    flex: none;
    color: var(--warning);
  }

  .uncommitted .on {
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
  }

  .uncommitted .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .uncommitted .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .uncommitted .btn.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .ai-explain {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    margin-top: 8px;
    padding: 3px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .ai-explain :global(svg) {
    color: var(--accent);
  }

  .ai-explain:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

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
    gap: 12px;
    padding: 14px;
    max-height: 62%;
    overflow-y: auto;
  }

  .summary {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
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

  .link {
    align-self: flex-start;
    margin-top: -6px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
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
    flex: 1;
  }

  .name {
    font-size: 13px;
    font-weight: 600;
  }

  .email {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .when {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex: none;
    font-size: 12px;
  }

  .rel {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .committer {
    margin: -4px 0 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .ids {
    display: grid;
    grid-template-columns: 46px 1fr;
    align-items: center;
    gap: 4px 6px;
    margin: 0;
    font-size: 12px;
  }

  .ids dt {
    color: var(--text-secondary);
  }

  .ids dd {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
  }

  code {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .icon-btn {
    display: grid;
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

  .sha-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .sha-link:hover {
    text-decoration: underline;
  }

  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
