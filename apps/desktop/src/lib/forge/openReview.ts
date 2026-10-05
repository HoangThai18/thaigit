// Open the review of a PR / MR: fetch the PR branch and the target branch locally (one fetch, through the
// repo's operation queue), find the merge base and list the changed files. A PR that can't be fetched
// (Bitbucket forks) opens the web page instead.

import type { ForgeMergeRequest } from '@thaigit/contracts';
import { handleNetworkError } from '../actions/errors.ts';
import { openUrl } from '../ipc/os.ts';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import type { ReviewChanges } from './review.svelte.ts';
import { pullRequestReview, targetOf } from './pullRequests.ts';
import type { RepoForgeTarget } from './target.ts';

/** `target`: the repo's host (defaults to the preferred remote; tests pass it explicitly to fetch from a local remote). */
export async function openReview(
  store: RepoStore,
  item: ForgeMergeRequest,
  target: RepoForgeTarget | null = targetOf(store),
): Promise<void> {
  if (target === null) return;
  const plan = pullRequestReview(item, target.provider, target.owner, target.remote);
  if (plan === null) {
    void openUrl(item.webUrl, true);
    return;
  }
  const title = vi.pullRequests.reviewing;
  const token = store.review.begin(item, target.provider);
  const progress = store.progressReporter();
  // Result box (TS doesn't track assignments made inside a closure, hence a plain variable).
  const result: { changes: ReviewChanges | null } = { changes: null };
  await store.perform(
    title,
    async (git, signal) => {
      await git.fetchRefspec(target.remote, plan.refspecs, { onProgress: progress, signal });
      const [head, base] = await Promise.all([
        git.resolveCommit(plan.headRef),
        git.resolveCommit(plan.baseRef),
      ]);
      // The two branches share no history (rare): diff directly against the target branch tip.
      const from = (await git.mergeBase(base, head)) ?? base;
      result.changes = { head, from, files: await git.changedFiles(head, from) };
    },
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.refs,
      onError: (error) => {
        store.review.fail(token);
        return handleNetworkError(store, error, title);
      },
    },
  );
  // `perform` already reported an error / was cancelled (no result): the panel shows a failed state with a retry button.
  if (result.changes === null) store.review.fail(token);
  else store.review.finish(token, result.changes);
}
