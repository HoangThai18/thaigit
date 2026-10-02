/**
 * Chủ đề: áp lựa chọn sáng/tối/theo hệ thống và kính/không kính lên `<html>`, và báo cho canvas graph vẽ lại khi màu đổi.
 * Token màu nằm ở tokens.css; ở đây chỉ bật tắt `data-theme` và lớp `no-glass` (cũng bật khi OS yêu cầu giảm trong suốt).
 */
import { untrack } from 'svelte';
import type { ColorScheme } from '../stores/prefs.svelte.ts';

function query(text: string): MediaQueryList | null {
  return typeof matchMedia === 'undefined' ? null : matchMedia(text);
}

export class ThemeStore {
  /** Tăng mỗi khi bảng màu có thể đã đổi (đổi sáng/tối hệ thống, đổi lựa chọn) → canvas vẽ lại với màu mới. */
  version = $state(0);
  /** OS đang bật "Giảm độ trong suốt" (macOS) / tắt "Transparency effects" (Windows) — nếu webview báo được. */
  systemReducedTransparency = $state(query('(prefers-reduced-transparency: reduce)')?.matches ?? false);

  apply(scheme: ColorScheme, glass: boolean, root: HTMLElement = document.documentElement): void {
    if (scheme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', scheme);
    root.classList.toggle('no-glass', !glass || this.systemReducedTransparency);
    // `apply` chạy trong $effect: đọc `version` ở đây sẽ làm effect tự kích hoạt lại mãi.
    untrack(() => {
      this.version += 1;
    });
  }

  /** Theo dõi đổi sáng/tối và "giảm trong suốt" của hệ thống. Trả hàm huỷ. */
  watchSystem(): () => void {
    const dark = query('(prefers-color-scheme: dark)');
    const transparency = query('(prefers-reduced-transparency: reduce)');
    const onScheme = (): void => {
      this.version++;
    };
    const onTransparency = (): void => {
      this.systemReducedTransparency = transparency?.matches ?? false;
    };
    dark?.addEventListener('change', onScheme);
    transparency?.addEventListener('change', onTransparency);
    return () => {
      dark?.removeEventListener('change', onScheme);
      transparency?.removeEventListener('change', onTransparency);
    };
  }
}

export const theme = new ThemeStore();
