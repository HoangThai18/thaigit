/**
 * Tải thêm lịch sử khi cuộn gần cuối graph (như Swift: còn ≤ 30 hàng). Phải gọi lúc khởi tạo component (dùng `$effect`).
 *
 * Chỉ yêu cầu MỘT lần cho mỗi độ dài danh sách: tải thêm hỏng (hoặc không thêm được hàng nào) thì `entries.length` không đổi,
 * nếu không có chốt này thì mỗi lần `isLoadingHistory` tắt effect lại chạy và gọi `git log` lần nữa — vô tận. Danh sách dài
 * ra (tải thành công) mới được yêu cầu tiếp. Store còn tự chặn thêm bằng `loadMoreFailed` (chỉ người dùng mới thử lại được).
 */
import { untrack } from 'svelte';
import type { RepoStore } from '../stores/repo.svelte.ts';

export type LoadMoreSource = Pick<
  RepoStore,
  'mayHaveMoreCommits' | 'isLoadingHistory' | 'loadMoreFailed' | 'entries' | 'loadMoreHistory'
>;

export function autoLoadMore(getStore: () => LoadMoreSource, rangeEnd: () => number, margin = 30): void {
  let requestedFor = -1;
  $effect(() => {
    const store = getStore();
    const total = store.entries.length;
    const end = rangeEnd();
    if (!store.mayHaveMoreCommits || store.isLoadingHistory || store.loadMoreFailed) return;
    if (end <= 0 || end < total - margin || requestedFor === total) return;
    requestedFor = total;
    untrack(() => store.loadMoreHistory());
  });
}
