// Mở review của một PR / MR: lấy nhánh của PR và nhánh đích về máy (một lần fetch, qua hàng đợi thao tác của repo), tìm điểm tách
// rồi liệt kê file thay đổi. PR không lấy về được (Bitbucket từ fork) thì mở trang web.

import type { ForgeMergeRequest } from '@thaigit/contracts';
import { handleNetworkError } from '../actions/errors.ts';
import { openUrl } from '../ipc/os.ts';
import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import type { ReviewChanges } from './review.svelte.ts';
import { pullRequestReview, targetOf } from './pullRequests.ts';
import type { RepoForgeTarget } from './target.ts';

/** `target`: máy chủ của repo (mặc định đọc từ remote ưu tiên; test truyền sẵn để fetch từ remote cục bộ). */
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
  // Hộp kết quả (TS không theo dõi phép gán trong closure nên không dùng biến thường).
  const result: { changes: ReviewChanges | null } = { changes: null };
  await store.perform(
    title,
    async (git, signal) => {
      await git.fetchRefspec(target.remote, plan.refspecs, { onProgress: progress, signal });
      const [head, base] = await Promise.all([
        git.resolveCommit(plan.headRef),
        git.resolveCommit(plan.baseRef),
      ]);
      // Hai nhánh không có lịch sử chung (hiếm): so thẳng với đầu nhánh đích.
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
  // `perform` đã báo lỗi / huỷ (không có kết quả): panel hiện trạng thái thất bại để bấm thử lại.
  if (result.changes === null) store.review.fail(token);
  else store.review.finish(token, result.changes);
}
