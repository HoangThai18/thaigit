import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  Commands,
  Events,
  type UpdateAvailableEvent,
  type UpdateChannel,
  type UpdateInfo,
  type UpdateProgressEvent,
} from '@thaigit/contracts';
import { call } from './invoke.ts';

// Automatic updates: every decision (channel, valid version, signature, when to install) lives in Rust; the webview only asks and listens.

/** Check for a newer build of the current channel; `null` = already up to date. */
export function updateCheck(): Promise<UpdateInfo | null> {
  return call<UpdateInfo | null>(Commands.updateCheck);
}

/** Download + verify the signature + install the build `updateCheck` just reported; the app restarts itself (on Windows the installer runs and the app exits). */
export function updateInstall(): Promise<void> {
  return call<void>(Commands.updateInstall);
}

export function updateSetChannel(channel: UpdateChannel): Promise<void> {
  return call<void>(Commands.updateSetChannel, { channel });
}

/** Tell Rust the UI has finished rendering (safe mode counts bad startups). */
export function appReady(): Promise<void> {
  return call<void>(Commands.appReady);
}

export async function onUpdateAvailable(handler: (event: UpdateAvailableEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<UpdateAvailableEvent>(Events.updateAvailable, (event) =>
    handler(event.payload),
  );
}

export async function onUpdateProgress(handler: (event: UpdateProgressEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<UpdateProgressEvent>(Events.updateProgress, (event) =>
    handler(event.payload),
  );
}
