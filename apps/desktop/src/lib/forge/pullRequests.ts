// The repo's Pull Request / Merge Request area: load the list of open PRs (Rust calls the API with the
// right account's token) and reload it after every fetch. Every string returned by a host is rendered as
// text.

import type { ForgeMergeRequest, ForgeProvider } from '@thaigit/contracts';
import { isValidRefName } from '@thaigit/core';
import { forgeListMergeRequests } from '../ipc/accounts.ts';
import { vi } from '../strings.vi.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { repoForgeTarget, type RepoForgeTarget } from './target.ts';

/** Whether this repo talks to a host the app recognises (GitHub / GitLab / Bitbucket). */
export function targetOf(store: RepoStore): RepoForgeTarget | null {
  return repoForgeTarget(store.remotes);
}

/** Open PRs of the repo (Rust picks the account by owner). */
export async function fetchMergeRequests(store: RepoStore): Promise<ForgeMergeRequest[]> {
  const target = targetOf(store);
  if (target === null) return [];
  return forgeListMergeRequests({
    host: target.host,
    provider: target.provider ?? undefined,
    owner: target.owner,
    repo: target.repo,
  });
}

/** Load + classify errors for the sidebar: no host / not signed in / friendly error. */
export async function loadMergeRequests(store: RepoStore): Promise<MergeRequestState> {
  const target = targetOf(store);
  if (target === null) return { items: [], error: null, needsAccount: false };
  try {
    const items = await fetchMergeRequests(store);
    return { items, error: null, needsAccount: false };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // `not-found` / `auth`: no account on that host can reach this repo (not signed in, or missing permission).
    if (code === 'not-found' || code === 'auth') return { items: [], error: null, needsAccount: true };
    return { items: [], error: forgeErrorText(error), needsAccount: false };
  }
}

export interface MergeRequestState {
  items: ForgeMergeRequest[];
  error: string | null;
  needsAccount: boolean;
}

/** How to bring a PR's branch down: the refspec to fetch, the remote-tracking ref it lands in, and the local branch name. */
export interface PullRequestCheckout {
  refspec: string;
  remoteRef: string;
  localName: string;
  /** Branch already in this repo (not a fork): the local branch tracks the same-named remote branch. */
  sameRepo: boolean;
}

/**
 * PR in the same repo: fetch the source branch as usual. Forked PR: GitHub exposes ref `refs/pull/<n>/head`
 * and GitLab `refs/merge-requests/<n>/head` on the target repo itself; Bitbucket has no such ref → `null`
 * (web view only).
 */
export function pullRequestCheckout(
  item: ForgeMergeRequest,
  provider: ForgeProvider | null,
  owner: string,
  remote: string,
): PullRequestCheckout | null {
  const sameRepo = item.headOwner.toLowerCase() === owner.toLowerCase() && item.sourceBranch !== '';
  if (sameRepo) {
    return {
      refspec: `+refs/heads/${item.sourceBranch}:refs/remotes/${remote}/${item.sourceBranch}`,
      remoteRef: `${remote}/${item.sourceBranch}`,
      localName: item.sourceBranch,
      sameRepo,
    };
  }
  if (!/^\d+$/.test(item.number)) return null;
  if (provider === 'github') {
    return {
      refspec: `+refs/pull/${item.number}/head:refs/remotes/${remote}/pr/${item.number}`,
      remoteRef: `${remote}/pr/${item.number}`,
      localName: `pr/${item.number}`,
      sameRepo,
    };
  }
  if (provider === 'gitlab') {
    return {
      refspec: `+refs/merge-requests/${item.number}/head:refs/remotes/${remote}/mr/${item.number}`,
      remoteRef: `${remote}/mr/${item.number}`,
      localName: `mr/${item.number}`,
      sameRepo,
    };
  }
  return null;
}

/** How to bring a PR down for review: the refspec to fetch (source + target branch) and the two refs to fetch into for the comparison. */
export interface PullRequestReview {
  refspecs: string[];
  /** Head ref of the PR branch (already fetched). */
  headRef: string;
  /** Target branch ref (already fetched): the merge base of the PR against it anchors "Files changed". */
  baseRef: string;
}

/**
 * Same condition as `pullRequestCheckout` (a Bitbucket fork PR has no ref to fetch → `null`, web view
 * only), plus the target branch. The branch name comes from the host, so it may only be interpolated into
 * the refspec when it is a valid branch name (a `:` or `+` would change the refspec's meaning).
 */
export function pullRequestReview(
  item: ForgeMergeRequest,
  provider: ForgeProvider | null,
  owner: string,
  remote: string,
): PullRequestReview | null {
  const plan = pullRequestCheckout(item, provider, owner, remote);
  if (plan === null || !isValidRefName(item.targetBranch)) return null;
  if (plan.sameRepo && !isValidRefName(item.sourceBranch)) return null;
  const baseRef = `refs/remotes/${remote}/${item.targetBranch}`;
  return {
    refspecs: [plan.refspec, `+refs/heads/${item.targetBranch}:${baseRef}`],
    headRef: `refs/remotes/${plan.remoteRef}`,
    baseRef,
  };
}

/** Short status label of a PR in the list / review panel (empty for an open, non-draft PR). */
export function requestStateLabel(item: ForgeMergeRequest): string {
  const text = vi.pullRequests;
  if (item.state === 'merged') return text.merged;
  if (item.state === 'closed') return text.closed;
  return item.draft ? text.draft : '';
}
