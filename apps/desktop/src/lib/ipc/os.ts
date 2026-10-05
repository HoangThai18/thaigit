import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Commands } from '@thaigit/contracts';
import { call } from './invoke.ts';

/** Open a terminal at the repo root (macOS: Ghostty → iTerm2 → Warp → Terminal; Windows: wt.exe → PowerShell). */
export function openInTerminal(repoId: string): Promise<void> {
  return call<void>(Commands.openInTerminal, { repoId });
}

/** Open the editor (VS Code → Cursor → Zed → Sublime); `relativePath` must be inside the repo. */
export function openInEditor(repoId: string, relativePath?: string): Promise<void> {
  return call<void>(Commands.openInEditor, { repoId, path: relativePath ?? null });
}

/** Reveal in Finder/Explorer; `relativePath` must be inside the repo. */
export function reveal(repoId: string, relativePath?: string): Promise<void> {
  return call<void>(Commands.reveal, { repoId, path: relativePath ?? null });
}

/**
 * Open a URL with the default handler. Rust only accepts `https:` (no embedded credentials); `mailto:`
 * only when `confirmed` (the UI must ask the user first). URLs taken from commits/AI need to be shown in
 * full before the call.
 */
export function openUrl(url: string, confirmed = false): Promise<void> {
  return call<void>(Commands.openUrl, { url, confirmed });
}

/** Tell Rust the UI language (folder picker title, the startup "safe mode" dialog). */
export function setNativeLocale(locale: 'vi' | 'en'): Promise<void> {
  return call<void>(Commands.appSetLocale, { locale });
}

/** Open another Thaigit window (the home screen) to work with other repos in parallel. */
export function newWindow(): Promise<void> {
  return call<void>(Commands.newWindow);
}

/** The app's first window (the `main` label in tauri.conf) — the only one that remembers and reopens its tabs at startup. */
export function isMainWindow(): boolean {
  return getCurrentWebviewWindow().label === 'main';
}
