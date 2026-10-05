// UI language (Vietnamese / English). Chosen in Settings, stored in the webview's localStorage; the string set
// is picked ONCE when the app loads (`strings.vi.ts`), so changing the language reloads the window. This file
// imports nothing: `strings.vi.ts` needs it while loading, and pulling in a module that itself imports
// strings would be a circular import. Telling Rust (`setNativeLocale`) is the caller's job.

export type Locale = 'vi' | 'en';

/** Each language's name written in that language itself (not translated). */
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

/** The stored language; never chosen / unreadable → Vietnamese. */
export function readLocale(from: LocaleStorage | null = storage()): Locale {
  try {
    return from?.getItem(LOCALE_KEY) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

/** The language of this app load. */
export const locale: Locale = readLocale();

/** Store the choice (no reload here — the caller decides). */
export function saveLocale(next: Locale, to: LocaleStorage | null = storage()): void {
  try {
    to?.setItem(LOCALE_KEY, next);
  } catch {
    // Storage unavailable (private mode…): the choice only lasts until the app closes.
  }
}
