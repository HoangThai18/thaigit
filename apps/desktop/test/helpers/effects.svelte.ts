// Cầu nối để test (file `.test.ts` không biên dịch được rune) chạy `$effect` ngoài component: dùng trong dự án `dom`, nơi Svelte
// nạp bản client nên rune có phản ứng thật.
import { flushSync } from 'svelte';
import { autoLoadMore, type LoadMoreSource } from '../../src/lib/graph/autoLoadMore.svelte.ts';

/** Gắn effect "tải thêm khi cuộn gần cuối" của GraphView với `rangeEnd` do test điều khiển; trả hàm gỡ. */
export function mountAutoLoadMore(store: LoadMoreSource, rangeEnd: () => number): () => void {
  const stop = $effect.root(() => {
    autoLoadMore(() => store, rangeEnd);
  });
  flushSync();
  return stop;
}

/**
 * Store giả "ngây thơ": mỗi lần `loadMoreHistory()` chỉ bật rồi tắt `isLoadingHistory`, danh sách không đổi (như một lần tải thêm
 * hỏng mà store không tự chặn). Effect của GraphView phải tự không gọi lại cho cùng một độ dài danh sách.
 */
export class NaiveLoadMoreStore implements LoadMoreSource {
  mayHaveMoreCommits = $state(true);
  isLoadingHistory = $state(false);
  loadMoreFailed = $state(false);
  entries = $state.raw<LoadMoreSource['entries']>(Array.from({ length: 200 }, () => undefined as never));
  calls = 0;

  loadMoreHistory(): void {
    this.calls++;
    this.isLoadingHistory = true;
    setTimeout(() => (this.isLoadingHistory = false), 0);
  }
}

/** Đếm số lần một `$derived` đọc `prefs.value.sidebarSections` / `columns` / `scheme` báo "đã đổi" (effect phụ thuộc chạy lại). */
export function watchPrefs(prefs: {
  value: { sidebarSections: unknown; columns: unknown; scheme: unknown };
}) {
  const counts = { sections: 0, columns: 0, scheme: 0 };
  const stop = $effect.root(() => {
    const sections = $derived(prefs.value.sidebarSections);
    const columns = $derived(prefs.value.columns);
    const scheme = $derived(prefs.value.scheme);
    $effect(() => {
      void sections;
      counts.sections++;
    });
    $effect(() => {
      void columns;
      counts.columns++;
    });
    $effect(() => {
      void scheme;
      counts.scheme++;
    });
  });
  flushSync();
  return { counts, stop, flush: () => flushSync() };
}
