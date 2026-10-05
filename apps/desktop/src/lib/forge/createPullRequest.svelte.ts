// Create Pull Request / Merge Request dialog: target branch, title, description (with a write-with-AI
// button) and a draft flag. One dialog at a time; every string returned by a host is rendered as text.

import type { ForgeMergeRequest, ForgeProvider } from '@thaigit/contracts';
import { finalizeMarkdown, refName, stripThinking } from '@thaigit/core';
import { prContext } from '../ai/context.ts';
import { friendlyError } from '../errors/friendly.ts';
import { forgeCreateMergeRequest } from '../ipc/accounts.ts';
import { ai as defaultAi, type AiStore } from '../stores/ai.svelte.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { toasts } from '../stores/toasts.svelte.ts';
import { vi } from '../strings.vi.ts';
import { targetOf } from './pullRequests.ts';
import { requestWording } from './wording.ts';

const text = vi.pullRequests;

/** Default target branch: main / master / develop / dev when one exists, otherwise the first branch. */
export function defaultBase(names: readonly string[]): string | null {
  for (const candidate of ['main', 'master', 'develop', 'dev']) {
    if (names.includes(candidate)) return candidate;
  }
  return names[0] ?? null;
}

/** Branch names on `remote` (the `remote/` prefix and `HEAD` are stripped). */
export function branchesOnRemote(store: RepoStore, remote: string): string[] {
  const prefix = `${remote}/`;
  return store.remoteBranches
    .map(refName)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .filter((name) => name !== '' && name !== 'HEAD');
}

/**
 * Name of the local branch `local` has on `remote` (the PR head must already be pushed): its upstream
 * when that upstream lives on this remote, otherwise the branch with the same name; `null` = never
 * pushed.
 */
export function pushedName(store: RepoStore, remote: string, local: string): string | null {
  const ref = store.localBranches.find((branch) => refName(branch) === local);
  const upstream = ref?.upstream ? store.splitUpstream(ref.upstream) : null;
  const onRemote = branchesOnRemote(store, remote);
  if (upstream && upstream.remote === remote && onRemote.includes(upstream.branch)) return upstream.branch;
  return onRemote.includes(local) ? local : null;
}

export interface CreateState {
  store: RepoStore;
  /** Remote holding the repo on the host (`origin`…) — used to diff against the target branch while writing the description. */
  remote: string;
  provider: ForgeProvider | null;
  /** Source branch on the remote. */
  sourceBranch: string;
  bases: readonly string[];
  base: string;
  title: string;
  body: string;
  draft: boolean;
  submitting: boolean;
  writing: boolean;
  error: string | null;
}

export class CreatePullRequestStore {
  // Deep `$state`: the dialog edits each field (title, description as it is being written…) and the UI must see it immediately.
  current = $state<CreateState | null>(null);
  readonly #ai: AiStore;
  #writing: AbortController | null = null;

  constructor(ai: AiStore = defaultAi) {
    this.#ai = ai;
  }

  close(): void {
    this.#writing?.abort();
    this.#writing = null;
    this.current = null;
  }

  /**
   * Open the create-PR dialog for local branch `head`. Returns `false` (with a message) when the repo doesn't
   * talk to a host the app recognises, the branch has never been pushed, or the remote has no other
   * candidate target branch.
   */
  async open(store: RepoStore, head: string): Promise<boolean> {
    const target = targetOf(store);
    if (target === null) {
      toasts.error(text.notConnected);
      return false;
    }
    const source = pushedName(store, target.remote, head);
    if (source === null) {
      toasts.error(requestWording(target.provider).notPushed(head));
      return false;
    }
    const bases = branchesOnRemote(store, target.remote).filter((name) => name !== source);
    const base = defaultBase(bases);
    if (base === null) {
      toasts.error(text.noBase);
      return false;
    }
    const remote = target.remote;
    const title = await store.git
      .recentSubjects(1, `${remote}/${source}`, `${remote}/${base}`)
      .then((subjects) => subjects[0] ?? '')
      .catch(() => '');
    this.close();
    this.current = {
      store,
      remote,
      provider: target.provider,
      sourceBranch: source,
      bases,
      base,
      title,
      body: '',
      draft: false,
      submitting: false,
      writing: false,
      error: null,
    };
    return true;
  }

  setBase(base: string): void {
    if (this.current !== null) this.current.base = base;
  }

  setTitle(title: string): void {
    if (this.current !== null) this.current.title = title;
  }

  setBody(body: string): void {
    if (this.current !== null) this.current.body = body;
  }

  setDraft(draft: boolean): void {
    if (this.current !== null) this.current.draft = draft;
  }

  /** AI-written description from the diff plus commits between the target and source branches (on the remote); asks for consent if not given yet. */
  async writeDescription(): Promise<void> {
    const current = this.current;
    if (current === null || current.writing) return;
    current.writing = true;
    current.error = null;
    const controller = new AbortController();
    this.#writing = controller;
    try {
      const prepared = await prContext(
        current.store.git,
        this.#ai,
        `${current.remote}/${current.base}`,
        `${current.remote}/${current.sourceBranch}`,
      );
      if (prepared === null) {
        current.error = vi.ai.prNoChanges;
        return;
      }
      if (!(await this.#ai.askConsent(prepared.preview))) return;
      let raw = '';
      for await (const frame of this.#ai.run('pr', prepared.request, controller.signal)) {
        if (frame.type === 'delta') {
          raw += frame.text;
          // Text streaming into the description field (display only; nothing is submitted before Create is pressed).
          current.body = stripThinking(raw).trimStart();
        } else if (frame.type === 'done') {
          current.body = finalizeMarkdown(raw);
          return;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) current.error = friendlyError(error);
    } finally {
      current.writing = false;
      if (this.#writing === controller) this.#writing = null;
      controller.abort();
    }
  }

  /** Submit the PR creation; close the dialog on success, keep it open on error so the user can fix it. */
  async submit(onCreated?: (item: ForgeMergeRequest) => void): Promise<void> {
    const current = this.current;
    if (current === null || current.submitting) return;
    const target = targetOf(current.store);
    if (target === null) {
      current.error = text.notConnected;
      return;
    }
    if (current.title.trim() === '') {
      current.error = text.needsTitle;
      return;
    }
    if (current.base === current.sourceBranch) {
      current.error = text.sameBranch;
      return;
    }
    current.submitting = true;
    current.error = null;
    try {
      const created = await forgeCreateMergeRequest({
        host: target.host,
        provider: target.provider ?? undefined,
        owner: target.owner,
        repo: target.repo,
        title: current.title.trim(),
        body: current.body,
        sourceBranch: current.sourceBranch,
        targetBranch: current.base,
        draft: current.draft,
      });
      toasts.success(requestWording(target.provider).createdToast(created.number));
      this.close();
      onCreated?.(created);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      current.error = code === 'conflict' ? requestWording(target.provider).rejected : forgeErrorText(error);
    } finally {
      current.submitting = false;
    }
  }
}

export const createPullRequest = new CreatePullRequestStore();
