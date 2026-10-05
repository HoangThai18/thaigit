import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Commands, Events, type RepoChangedEvent } from '@thaigit/contracts';
import { call } from './invoke.ts';

/**
 * Watch a repo for changes (adaptive debounce + gitignore filtering + silencing while the app itself is
 * writing, all inside Rust). Subscribe to the event BEFORE starting the watcher so the first change is
 * never missed. Returns a stop function.
 * Uses this window's own `listen`: the `repo-changed` event is sent by Rust per window label.
 */
export async function watchRepo(
  repoId: string,
  onChange: (event: RepoChangedEvent) => void,
): Promise<() => Promise<void>> {
  const unlisten = await getCurrentWebviewWindow().listen<RepoChangedEvent>(Events.repoChanged, (event) => {
    if (event.payload.repoId === repoId) onChange(event.payload);
  });
  try {
    await call<void>(Commands.watchRepo, { repoId });
  } catch (error) {
    unlisten();
    throw error;
  }
  return async () => {
    unlisten();
    await call<void>(Commands.unwatchRepo, { repoId });
  };
}

/** Rust emits `git-env-changed` when git changes or is re-detected (e.g. a login shell finished loading PATH). Returns an unsubscribe function. */
export async function onGitEnvChanged(handler: () => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen(Events.gitEnvChanged, () => handler());
}
