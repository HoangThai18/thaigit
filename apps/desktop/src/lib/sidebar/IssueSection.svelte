<script lang="ts">
  import { untrack } from 'svelte';
  import type { ForgeIssue } from '@thaigit/contracts';
  import { beginCreateBranch } from '../actions/branches.ts';
  import { filterIssues, issueBranchName, loadIssues, type IssueState } from '../forge/issues.ts';
  import { targetOf } from '../forge/pullRequests.ts';
  import { showBidi } from '../format/bidi.ts';
  import { openUrl } from '../ipc/os.ts';
  import { menus } from '../stores/menus.svelte.ts';
  import { prefs } from '../stores/prefs.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import './sidebar.css';

  interface Props {
    store: RepoStore;
  }

  let { store }: Props = $props();

  const text = vi.issues;
  const SIDEBAR_LIMIT = 12;
  const EMPTY: IssueState = { items: [], error: null, needsAccount: false };
  let issues: IssueState = $state.raw(EMPTY);
  let loading = $state(false);
  let showAll = $state(false);
  let query = $state('');

  const sections = $derived(prefs.value.sidebarSections);
  const visible = $derived(sections.issues);
  const target = $derived(targetOf(store));
  const targetKey = $derived(target === null ? '' : `${target.host}/${target.owner}/${target.repo}`);
  const matching = $derived(filterIssues(issues.items, query));
  const items = $derived(showAll || query !== '' ? matching : matching.slice(0, SIDEBAR_LIMIT));

  function toggle(): void {
    prefs.update({ sidebarSections: { ...sections, issues: !sections.issues } });
  }

  let loadedKey = '';

  async function refresh(): Promise<void> {
    const key = targetKey;
    loadedKey = key;
    loading = true;
    const next = await loadIssues(store);
    if (key !== loadedKey) return;
    issues = next;
    loading = false;
  }

  $effect(() => {
    const key = visible ? targetKey : '';
    if (key === '' || key === loadedKey) return;
    issues = EMPTY;
    untrack(() => void refresh());
  });

  function openWeb(item: ForgeIssue): void {
    if (item.webUrl !== '') void openUrl(item.webUrl, true);
  }

  function createBranch(item: ForgeIssue): void {
    const head = store.headOid;
    if (head === null) return void beginCreateBranch(store);
    void beginCreateBranch(store, {
      sha: head,
      label: store.currentBranch ?? head.slice(0, 7),
      name: issueBranchName(item),
    });
  }

  function menuFor(item: ForgeIssue) {
    return [
      {
        title: text.openOnWeb,
        icon: 'globe' as const,
        disabled: item.webUrl === '',
        run: () => openWeb(item),
      },
      { title: text.createBranch, icon: 'branch' as const, run: () => createBranch(item) },
      { kind: 'separator' as const },
      {
        title: text.copyLink,
        icon: 'copy' as const,
        disabled: item.webUrl === '',
        run: () => void store.copy(item.webUrl, text.linkLabel),
      },
      {
        title: text.copyRef,
        icon: 'copy' as const,
        run: () => void store.copy(`#${item.number}`, text.refLabel),
      },
    ];
  }

  function tooltip(item: ForgeIssue): string {
    const lines = [text.tooltip(text.ref(item.number), item.title, item.author, item.comments)];
    if (item.assignees.length > 0)
      lines.push(text.assigned(item.assignees.map((person) => person.username).join(', ')));
    if (item.labels.length > 0) lines.push(item.labels.join(' · '));
    return showBidi(lines.join('\n'));
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
    <span class="sh-icon"><Icon name="issue" size={14} /></span>
    <span class="sh-title">{text.section}</span>
    <span class="sb-count">{issues.items.length}</span>
    <span class="sh-chevron"
      ><Icon name={visible ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} /></span
    >
  </button>
  {#if visible}
    {#if target === null}
      <p class="placeholder">{text.notConnected}</p>
    {:else if issues.needsAccount}
      <p class="placeholder">{text.noAccount}</p>
    {:else}
      <div class="toolbar">
        <button
          type="button"
          class="mini"
          disabled={loading || targetKey === ''}
          title={text.refresh}
          aria-label={text.refresh}
          onclick={() => void refresh()}
        >
          <Icon name="fetch" size={12} />
        </button>
        {#if issues.items.length > 0}
          <input
            type="text"
            class="filter"
            bind:value={query}
            placeholder={text.filterPlaceholder}
            aria-label={text.filterPlaceholder}
            spellcheck="false"
            autocomplete="off"
          />
        {/if}
        {#if loading}
          <span class="mini-note"><Icon name="spinner" size={11} />{text.loading}</span>
        {/if}
      </div>
      {#if issues.error}
        <p class="placeholder error">{issues.error}</p>
      {:else if issues.items.length === 0}
        <p class="placeholder">{text.empty}</p>
      {:else if matching.length === 0}
        <p class="placeholder">{text.noMatch}</p>
      {:else}
        {#each items as item (item.host + '/' + item.number)}
          <button
            type="button"
            class="sb-row"
            title={tooltip(item)}
            onclick={() => openWeb(item)}
            oncontextmenu={(event) => menus.openAt(event, menuFor(item))}
          >
            <span class="sb-icon issue-icon"><Icon name="issue" size={13} /></span>
            <span class="sb-title"><bdi>{text.ref(item.number)} {showBidi(item.title)}</bdi></span>
            {#if item.labels[0]}
              <span class="label"><bdi>{showBidi(item.labels[0])}</bdi></span>
            {/if}
          </button>
        {/each}
        {#if query === '' && issues.items.length > SIDEBAR_LIMIT}
          <button type="button" class="more" onclick={() => (showAll = !showAll)}>
            {showAll ? '−' : `+${issues.items.length - SIDEBAR_LIMIT}`}
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

  .sh-icon {
    display: grid;
    flex: none;
    width: 16px;
    color: var(--lane-4);
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
    flex: none;
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

  .filter {
    flex: 1 1 auto;
    min-width: 0;
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 11.5px;
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

  .issue-icon {
    color: var(--lane-3);
  }

  .label {
    flex: none;
    max-width: 80px;
    overflow: hidden;
    padding: 0 5px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--lane-4) 16%, transparent);
    color: var(--text-secondary);
    font-size: 10.5px;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
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
