<!--
  Mục PULL REQUESTS ở sidebar: PR đang mở của repo (Rust gọi API với token đúng tài khoản), nút tạo PR, và nút tải lại.
  Chữ từ máy chủ (tiêu đề, tên người mở) chỉ hiển thị dạng text.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ForgeMergeRequest } from '@thaigit/contracts';
  import { refName } from '@thaigit/core';
  import { checkoutPullRequest } from '../forge/checkoutPullRequest.ts';
  import { createPullRequest } from '../forge/createPullRequest.svelte.ts';
  import { openReview } from '../forge/openReview.ts';
  import {
    loadMergeRequests,
    pullRequestCheckout,
    requestStateLabel,
    targetOf,
    type MergeRequestState,
  } from '../forge/pullRequests.ts';
  import { showBidi } from '../format/bidi.ts';
  import { openUrl } from '../ipc/os.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import { requestWording } from '../forge/wording.ts';
  import './sidebar.css';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const text = vi.pullRequests;
  /** Số PR hiện mặc định; thêm nút "+n" để xem hết (sidebar hẹp không chứa nhiều). */
  const SIDEBAR_LIMIT = 12;
  const EMPTY: MergeRequestState = { items: [], error: null, needsAccount: false };
  let prs: MergeRequestState = $state.raw(EMPTY);
  let loading = $state(false);
  let showAll = $state(false);

  const sections = $derived(prefs.value.sidebarSections);
  const visible = $derived(sections.pullRequests);
  const target = $derived(targetOf(store));
  /** Repo trên máy chủ mà danh sách đang hiện thuộc về (đổi repo / đổi remote thì nạp lại). */
  const targetKey = $derived(target === null ? '' : `${target.host}/${target.owner}/${target.repo}`);
  const items = $derived(showAll ? prs.items : prs.items.slice(0, SIDEBAR_LIMIT));
  const head = $derived(store.currentBranchRef ? refName(store.currentBranchRef) : null);

  function toggle(): void {
    prefs.update({ sidebarSections: { ...sections, pullRequests: !sections.pullRequests } });
  }

  /** Repo đã nạp gần nhất — biến thường, không phải `$state`, để effect bên dưới không tự kích hoạt lại. */
  let loadedKey = '';

  async function refresh(): Promise<void> {
    const key = targetKey;
    loadedKey = key;
    loading = true;
    const next = await loadMergeRequests(store);
    // Người dùng đã chuyển repo trong lúc chờ: bỏ kết quả cũ.
    if (key !== loadedKey) return;
    prs = next;
    loading = false;
  }

  // Nạp khi mục mở ra và mỗi lần repo trên máy chủ đổi; kết quả rỗng / lỗi KHÔNG nạp lại (tránh gọi API liên tục).
  $effect(() => {
    const key = visible ? targetKey : '';
    if (key === '' || key === loadedKey) return;
    prs = EMPTY;
    untrack(() => void refresh());
  });

  function openWeb(item: ForgeMergeRequest): void {
    void openUrl(item.webUrl, true);
  }

  function menuFor(item: ForgeMergeRequest) {
    const plan =
      target === null ? null : pullRequestCheckout(item, target.provider, target.owner, target.remote);
    return [
      { title: text.reviewMenu, icon: 'compare' as const, run: () => void openReview(store, item) },
      { title: text.openOnWeb, icon: 'globe' as const, run: () => openWeb(item) },
      {
        title: text.checkout,
        icon: 'checkout' as const,
        disabled: plan === null,
        run: () => void checkoutPullRequest(store, item),
      },
    ];
  }

  function create(): void {
    if (head === null) return;
    void createPullRequest.open(store, head);
  }
</script>

<section>
  <button
    type="button"
    class="section-header"
    aria-expanded={visible}
    title={vi.sidebar.section(text.section)}
    onclick={toggle}
  >
    <span class="sh-icon"><Icon name="globe" size={14} /></span>
    <span class="sh-title">{text.section}</span>
    <span class="sb-count">{prs.items.length}</span>
    <span class="sh-chevron"
      ><Icon name={visible ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} /></span
    >
  </button>
  {#if visible}
    {#if target === null}
      <p class="placeholder">{text.notConnected}</p>
    {:else if prs.needsAccount}
      <p class="placeholder">{text.noAccount}</p>
    {:else}
      <div class="toolbar">
        <button
          type="button"
          class="mini"
          disabled={loading || head === null}
          title={requestWording(target?.provider).create}
          onclick={create}
        >
          <Icon name="plus" size={12} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          class="mini"
          disabled={loading || targetKey === ''}
          title={text.refresh}
          onclick={() => void refresh()}
        >
          <Icon name="fetch" size={12} />
        </button>
        {#if loading}
          <span class="mini-note"><Icon name="spinner" size={11} />{text.loading}</span>
        {/if}
      </div>
      {#if prs.error}
        <p class="placeholder error">{prs.error}</p>
      {:else if prs.items.length === 0}
        <p class="placeholder">{text.empty}</p>
      {:else}
        {#each items as item (item.host + '/' + item.number)}
          {@const label = requestStateLabel(item)}
          {@const reference = requestWording(target?.provider).reviewRef(item.number)}
          <button
            type="button"
            class="sb-row"
            class:selected={store.review.request?.host === item.host &&
              store.review.request?.number === item.number}
            title={showBidi(
              [`${reference} ${item.title}`, `${item.sourceBranch} → ${item.targetBranch}`, item.author].join(
                '\n',
              ),
            )}
            onclick={() => void openReview(store, item)}
            oncontextmenu={(event) => menus.openAt(event, menuFor(item))}
          >
            <span class="sb-icon"><Icon name="globe" size={14} /></span>
            <span class="sb-title"><bdi>{reference} {showBidi(item.title)}</bdi></span>
            {#if label}
              <span class="tag">{label}</span>
            {/if}
          </button>
        {/each}
        {#if prs.items.length > SIDEBAR_LIMIT}
          <button type="button" class="more" onclick={() => (showAll = !showAll)}>
            {showAll ? '−' : `+${prs.items.length - SIDEBAR_LIMIT}`}
          </button>
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<style>
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

  .placeholder {
    margin: 2px 10px 6px 34px;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.4;
  }

  .placeholder.error {
    color: var(--danger);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 10px 4px 34px;
  }

  .mini {
    display: grid;
    place-items: center;
    width: 20px;
    height: 18px;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--chip-fill);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .mini:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .mini-note {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-tertiary);
    font-size: 11px;
  }

  .sb-row {
    height: 24px;
    padding: 0 8px 0 34px;
    font-family: inherit;
    cursor: pointer;
  }

  .tag {
    flex: none;
    color: var(--text-tertiary);
    font-size: 11px;
  }

  .more {
    margin: 2px 10px 2px 34px;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
</style>
