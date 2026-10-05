// Lấy nhánh của một PR / MR về máy rồi checkout (dùng ở menu của sidebar và nút trong panel review).

import type { ForgeMergeRequest } from '@thaigit/contracts';
import { refName } from '@thaigit/core';
import { checkout } from '../actions/branches.ts';
import { handleNetworkError } from '../actions/errors.ts';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { pullRequestCheckout, targetOf } from './pullRequests.ts';

/** Nhánh của PR về máy rồi checkout (nhánh local đã có thì chỉ checkout). */
export async function checkoutPullRequest(store: RepoStore, item: ForgeMergeRequest): Promise<void> {
  const text = vi.pullRequests;
  const current = targetOf(store);
  if (current === null) return;
  const plan = pullRequestCheckout(item, current.provider, current.owner, current.remote);
  if (plan === null) return;
  const existing = store.localBranches.find((branch) => refName(branch) === plan.localName);
  const progress = store.progressReporter();
  await store.perform(
    text.checkout,
    async (git, signal) => {
      await git.fetchRefspec(current.remote, plan.refspec, { onProgress: progress, signal });
      if (existing) return;
      if (plan.sameRepo) {
        await git.checkoutTracking(plan.remoteRef, plan.localName);
      } else {
        // Nhánh của fork: không đặt upstream (remote không có nhánh `pr/<số>` để pull / push).
        await git.createBranch(plan.localName, plan.remoteRef, true);
        await git.unsetUpstream(plan.localName).catch(() => undefined);
      }
    },
    {
      showsProgress: true,
      cancellable: true,
      refresh: Scope.all,
      onError: (error) => handleNetworkError(store, error, text.checkout),
    },
  );
  if (existing) await checkout(store, existing);
}
