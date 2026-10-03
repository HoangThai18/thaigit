// Ngôn ngữ giao diện (tiếng Việt / tiếng Anh). Chọn trong Cài đặt, lưu ở localStorage của webview; chuỗi được chọn MỘT LẦN
// lúc nạp app (`strings.vi.ts`) — đổi ngôn ngữ thì tải lại cửa sổ. File này không import gì: `strings.vi.ts` cần nó lúc nạp,
// nên không được kéo theo module nào lại import chuỗi (vòng import). Báo Rust (`setNativeLocale`) do nơi gọi lo.

export type Locale = 'vi' | 'en';

/** Tên mỗi ngôn ngữ viết bằng chính ngôn ngữ đó (không dịch). */
export const LOCALES: readonly { readonly id: Locale; readonly name: string }[] = [
  { id: 'vi', name: 'Tiếng Việt' },
  { id: 'en', name: 'English' },
];

export const LOCALE_KEY = 'thaigit.locale';

interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): LocaleStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Ngôn ngữ đã lưu; chưa chọn / không đọc được → tiếng Việt. */
export function readLocale(from: LocaleStorage | null = storage()): Locale {
  try {
    return from?.getItem(LOCALE_KEY) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

/** Ngôn ngữ của lần nạp này. */
export const locale: Locale = readLocale();

/** Lưu lựa chọn (không tự tải lại — nơi gọi quyết định). */
export function saveLocale(next: Locale, to: LocaleStorage | null = storage()): void {
  try {
    to?.setItem(LOCALE_KEY, next);
  } catch {
    // Không ghi được (chế độ riêng tư…): lựa chọn chỉ có tác dụng tới khi đóng app.
  }
}
