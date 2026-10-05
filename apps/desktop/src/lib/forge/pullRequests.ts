// Phần Pull Request / Merge Request của repo: nạp danh sách PR đang mở (Rust gọi API bằng token đúng tài khoản), và nạp lại
// sau mỗi lần fetch. Mọi chữ do máy chủ trả về đều hiển thị dạng text.

import type { ForgeMergeRequest, ForgeProvider } from '@thaigit/contracts';
import { isValidRefName } from '@thaigit/core';
import { forgeListMergeRequests } from '../ipc/accounts.ts';
import { vi } from '../strings.vi.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { repoForgeTarget, type RepoForgeTarget } from './target.ts';

/** Repo này có nói chuyện với máy chủ app nhận ra không (GitHub / GitLab / Bitbucket). */
export function targetOf(store: RepoStore): RepoForgeTarget | null {
  return repoForgeTarget(store.remotes);
}

/** PR đang mở của repo (Rust tự chọn tài khoản theo owner). */
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

/** Nạp + phân loại lỗi cho sidebar: không có máy chủ / chưa đăng nhập / lỗi thân thiện. */
export async function loadMergeRequests(store: RepoStore): Promise<MergeRequestState> {
  const target = targetOf(store);
  if (target === null) return { items: [], error: null, needsAccount: false };
  try {
    const items = await fetchMergeRequests(store);
    return { items, error: null, needsAccount: false };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // `not-found` / `auth`: máy chủ không có tài khoản nào truy cập được repo này (chưa đăng nhập hoặc thiếu quyền).
    if (code === 'not-found' || code === 'auth') return { items: [], error: null, needsAccount: true };
    return { items: [], error: forgeErrorText(error), needsAccount: false };
  }
}

export interface MergeRequestState {
  items: ForgeMergeRequest[];
  error: string | null;
  needsAccount: boolean;
}

/** Cách lấy nhánh của một PR về máy: refspec để fetch, ref remote-tracking nhận về, và tên nhánh local. */
export interface PullRequestCheckout {
  refspec: string;
  remoteRef: string;
  localName: string;
  /** Nhánh nằm ngay trong repo (không phải fork): nhánh local theo dõi nhánh remote cùng tên. */
  sameRepo: boolean;
}

/**
 * PR cùng repo: fetch nhánh nguồn như bình thường. PR từ fork: GitHub để ref `refs/pull/<số>/head`, GitLab để
 * `refs/merge-requests/<số>/head` ngay trên repo đích; Bitbucket không có ref như vậy → `null` (chỉ mở trên web).
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

/** Cách lấy PR về máy để review: refspec cần fetch (nhánh nguồn + nhánh đích) và hai ref nhận về để so sánh. */
export interface PullRequestReview {
  refspecs: string[];
  /** Ref đầu nhánh của PR (đã fetch). */
  headRef: string;
  /** Ref nhánh đích (đã fetch): điểm tách của PR khỏi nó là mốc của "Files changed". */
  baseRef: string;
}

/**
 * Cùng điều kiện với `pullRequestCheckout` (PR từ fork của Bitbucket không có ref để lấy → `null`, chỉ xem trên web), thêm nhánh đích.
 * Tên nhánh do máy chủ trả về nên chỉ được ghép vào refspec khi là tên nhánh hợp lệ (ký tự `:` hay `+` đổi nghĩa refspec).
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

/** Nhãn trạng thái ngắn của một PR ở danh sách / panel review (PR đang mở và không phải nháp thì để trống). */
export function requestStateLabel(item: ForgeMergeRequest): string {
  const text = vi.pullRequests;
  if (item.state === 'merged') return text.merged;
  if (item.state === 'closed') return text.closed;
  return item.draft ? text.draft : '';
}
