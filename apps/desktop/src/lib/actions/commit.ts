// Commit / amend from the commit editor (a port of `commit()` in RepoModel+Actions.swift): joins summary + body, commits through
// the queue, clears the editor when done and offers "Undo" (a soft reset back to the old HEAD — the changes return to their staged state and the message goes back into the editor).

import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { push } from './remote.ts';

/** The full message from summary + body (surrounding whitespace trimmed; an empty body yields just the summary). */
export function composeMessage(summary: string, body: string): string {
  const head = summary.trim();
  const rest = body.trim();
  return rest === '' ? head : `${head}\n\n${rest}`;
}

/** Split an existing message (amend, MERGE_MSG) into summary + body. */
export function splitMessage(message: string): { summary: string; body: string } {
  const normalized = message.replace(/\r\n/g, '\n').trim();
  const newline = normalized.indexOf('\n');
  if (newline < 0) return { summary: normalized, body: '' };
  return { summary: normalized.slice(0, newline).trim(), body: normalized.slice(newline + 1).trim() };
}

export interface CommitCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

/** Whether there is anything to commit (enables / disables the button and explains why not). */
export function canCommit(store: RepoStore): CommitCheck {
  const draft = store.commitDraft;
  if (draft.summary.trim() === '') return { ok: false, reason: vi.staging.needSummary };
  if (store.status.conflicts.length > 0)
    return { ok: false, reason: vi.staging.conflictsFirst(store.status.conflicts.length) };
  // An amend that only changes the message needs nothing staged; while merging / reverting, committing finishes the operation.
  if (store.status.staged.length === 0 && !draft.amend && store.operation === null) {
    return { ok: false, reason: vi.staging.needStaged };
  }
  return { ok: true, reason: null };
}

/**
 * Turn amend on / off. When turning it on with an empty editor, prefill the latest commit's message (like Swift); when
 * turning it off, restore whatever was typed before it was enabled.
 */
export async function setAmend(
  store: RepoStore,
  amend: boolean,
  saved: { summary: string; body: string } | null,
): Promise<{ summary: string; body: string } | null> {
  const draft = store.commitDraft;
  draft.amend = amend;
  if (amend) {
    const before = { summary: draft.summary, body: draft.body };
    const head = store.headOid;
    if (head !== null && draft.summary.trim() === '' && draft.body.trim() === '') {
      try {
        const message = splitMessage(await store.git.commitMessage(head));
        draft.summary = message.summary;
        draft.body = message.body;
      } catch {
        // The old message cannot be read: leave it empty for the user to type.
      }
    }
    return before;
  }
  if (saved) {
    draft.summary = saved.summary;
    draft.body = saved.body;
  }
  return null;
}

/**
 * Whether "Commit & push" is available: there is a remote, we are on a branch, and amend is off (amending an already-pushed
 * commit is usually rejected by push, while "Pull first" creates a merge — better to let the user consider it).
 */
export function canCommitAndPush(store: RepoStore): boolean {
  return store.remotes.length > 0 && store.currentBranchRef !== undefined && !store.commitDraft.amend;
}

/**
 * Commit with the editor's content. `stageAllFirst`: "Stage all & commit". `push`: push the current branch once the commit
 * succeeds (no push when the commit fails).
 */
export async function commit(
  store: RepoStore,
  options: { stageAllFirst?: boolean; push?: boolean } = {},
): Promise<void> {
  const draft = store.commitDraft;
  const summary = draft.summary;
  const body = draft.body;
  const amend = draft.amend;
  const message = composeMessage(summary, body);
  if (summary.trim() === '') return;
  const previousHead = store.headOid;
  const branch = store.currentBranch ?? 'HEAD';
  let committed = false;
  await store.perform(
    vi.staging.committing,
    async (git) => {
      if (options.stageAllFirst) await git.stageAll();
      await git.commit(message, { amend });
      committed = true;
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        draft.summary = '';
        draft.body = '';
        draft.amend = false;
        store.select({ kind: 'workingTree' });
        store.notify('success', amend ? vi.staging.amended : vi.staging.committed(branch), {
          actions: committed
            ? [
                {
                  title: vi.staging.undo,
                  run: () => void undoCommit(store, previousHead, { summary, body, amend }),
                },
              ]
            : [],
        });
      },
    },
  );
  if (committed && options.push === true) await push(store);
}

/**
 * Undo the commit just created: move the branch back to `previousHead` keeping the changes (staged), and return the
 * message to the editor. For the branch's first commit (no old HEAD) delete the branch ref and keep the index.
 */
export function undoCommit(
  store: RepoStore,
  previousHead: string | null,
  restore: { summary: string; body: string; amend: boolean },
): Promise<void> {
  return store.perform(
    vi.staging.undoCommit,
    async (git) => {
      if (previousHead === null) await git.undoInitialCommit();
      else await git.softReset(previousHead);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        const draft = store.commitDraft;
        draft.summary = restore.summary;
        draft.body = restore.body;
        draft.amend = false;
        store.notify('success', vi.staging.undone);
      },
    },
  );
}
