<!--
  Một dòng "Người review" / "Người được gán" của panel review: tên những người hiện có, nút mở bảng chọn người (tìm theo tên, tick
  chọn, "Áp dụng" để gửi lên máy chủ). Tên, tên đăng nhập do máy chủ trả về chỉ được render dạng chữ — không {@html}.
-->
<script lang="ts">
  import type { ForgePerson } from '@thaigit/contracts';
  import { showBidi } from '../format/bidi.ts';
  import type { PeopleRole } from '../ipc/accounts.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import { loadReviewPeople, saveReviewPeople } from './reviewPeople.ts';

  interface Props {
    store: RepoStore;
    role: PeopleRole;
    /** Bitbucket chưa gán được từ app: chỉ hiện danh sách. */
    editable: boolean;
  }

  let { store, role, editable }: Props = $props();

  const text = vi.pullRequests;
  /** Số ứng viên hiện tối đa (danh sách thành viên có thể rất dài — gõ tên để thu hẹp). */
  const ROW_LIMIT = 200;

  const review = $derived(store.review);
  const request = $derived(review.request);
  const current = $derived<readonly ForgePerson[]>(
    role === 'reviewers' ? (request?.reviewers ?? []) : (request?.assignees ?? []),
  );
  const title = $derived(role === 'reviewers' ? text.reviewers : text.assignees);
  const chooseTitle = $derived(role === 'reviewers' ? text.chooseReviewers : text.chooseAssignees);

  let editing = $state(false);
  let query = $state('');
  let chosen = $state.raw<readonly ForgePerson[]>([]);

  const key = (person: ForgePerson): string => person.username.toLowerCase();
  const chosenKeys = $derived(new Set(chosen.map(key)));
  const changed = $derived.by(() => {
    const before = new Set(current.map(key));
    return before.size !== chosenKeys.size || [...chosenKeys].some((name) => !before.has(name));
  });

  /** Ứng viên: danh sách từ máy chủ cộng thêm những người đã được gán mà không có trong đó; người review không gồm tác giả. */
  const rows = $derived.by(() => {
    const known = new Set<string>();
    const all: ForgePerson[] = [];
    for (const person of [...review.candidates, ...current]) {
      if (known.has(key(person))) continue;
      known.add(key(person));
      all.push(person);
    }
    const author = request?.author.toLowerCase() ?? '';
    const allowed = role === 'reviewers' ? all.filter((person) => key(person) !== author) : all;
    const needle = query.trim().toLowerCase();
    const matching =
      needle === ''
        ? allowed
        : allowed.filter(
            (person) => key(person).includes(needle) || person.name.toLowerCase().includes(needle),
          );
    return matching.slice(0, ROW_LIMIT);
  });

  function open(): void {
    chosen = [...current];
    query = '';
    editing = true;
    void loadReviewPeople(store);
  }

  function toggle(person: ForgePerson): void {
    chosen = chosenKeys.has(key(person))
      ? chosen.filter((item) => key(item) !== key(person))
      : [...chosen, person];
  }

  async function apply(): Promise<void> {
    if (await saveReviewPeople(store, role, chosen)) editing = false;
  }

  function label(person: ForgePerson): string {
    return person.name === '' ? person.username : person.name;
  }
</script>

<div class="people">
  <div class="row">
    <span class="label">{title}</span>
    <div class="names">
      {#if current.length === 0}
        <span class="none">{text.nobody}</span>
      {/if}
      {#each current as person, index (index)}
        <span class="person selectable">
          <Icon name="user" size={12} />
          <bdi>{showBidi(label(person))}</bdi>
          {#if person.name !== '' && person.name !== person.username}
            <span class="handle"><bdi>@{showBidi(person.username)}</bdi></span>
          {/if}
        </span>
      {/each}
    </div>
    {#if editable}
      <button
        type="button"
        class="icon-btn"
        title={chooseTitle}
        aria-label={chooseTitle}
        aria-expanded={editing}
        disabled={review.saving}
        onclick={() => (editing ? (editing = false) : open())}
      >
        <Icon name="settings" size={13} />
      </button>
    {/if}
  </div>
  {#if editing}
    <div class="picker" role="group" aria-label={chooseTitle}>
      <input type="search" class="search" placeholder={text.searchPeople} bind:value={query} />
      {#if review.peoplePhase === 'failed'}
        <p class="hint" role="alert">{text.peopleLoadFailed}</p>
        <button type="button" class="btn" onclick={() => void loadReviewPeople(store)}>
          <Icon name="fetch" size={13} />
          <span>{text.reviewRetry}</span>
        </button>
      {:else if review.peoplePhase !== 'ready'}
        <p class="hint" role="status">{text.peopleLoading}</p>
      {:else}
        <div class="list">
          {#each rows as person, index (index)}
            <label class="choice">
              <input type="checkbox" checked={chosenKeys.has(key(person))} onchange={() => toggle(person)} />
              <span class="who"><bdi>{showBidi(label(person))}</bdi></span>
              {#if person.name !== '' && person.name !== person.username}
                <span class="handle"><bdi>@{showBidi(person.username)}</bdi></span>
              {/if}
            </label>
          {:else}
            <p class="hint">{text.noPeopleMatch}</p>
          {/each}
        </div>
      {/if}
      <div class="buttons">
        <button
          type="button"
          class="btn primary"
          disabled={!changed || review.saving}
          onclick={() => void apply()}
        >
          <span>{text.apply}</span>
        </button>
        <button type="button" class="btn" disabled={review.saving} onclick={() => (editing = false)}>
          <span>{text.cancel}</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .people {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .label {
    flex: none;
    width: 112px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
  }

  .names {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .none {
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .person {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 13px;
  }

  .person :global(svg) {
    flex: none;
    color: var(--text-secondary);
  }

  .handle {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
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

  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-m);
    background: var(--field-fill);
  }

  .search {
    padding: 4px 8px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  .list {
    display: flex;
    flex-direction: column;
    max-height: 200px;
    overflow-y: auto;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: var(--radius-s);
    font-size: 13px;
    cursor: pointer;
  }

  .choice:hover {
    background: var(--row-hover);
  }

  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .buttons {
    display: flex;
    gap: 6px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .btn.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn:focus-visible,
  .icon-btn:focus-visible,
  .search:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
