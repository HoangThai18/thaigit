/** English translation of `updat.vi.ts` (same keys, same parameters). */
import type { update as source } from './update.vi.ts';
import type { Translation } from './types.ts';

export const update: Translation<typeof source> = {
  available: (version: string) => `Thaigit ${version} is available`,
  availableMessage: (current: string) =>
    `You are on ${current}. The app restarts automatically after updating.`,
  installNow: 'Update now',
  later: 'Later',
  notes: "What's new",
  notesTitle: (version: string) => `What's new in ${version}`,
  checkNow: 'Check for updates…',
  installMenu: (version: string) => `Update to ${version}…`,
  checking: 'Checking for updates…',
  upToDate: (version: string) => `You're on the latest version (${version})`,
  checkFailed: "Couldn't check for updates",
  installConfirmTitle: (version: string) => `Update to Thaigit ${version}?`,
  installConfirmMessage:
    'Thaigit will download the new version, verify its signature, install it and restart. Open repositories will be reopened.',
  installConfirm: 'Update & restart',
  downloading: 'Downloading update',
  verifying: 'Verifying signature',
  installing: 'Installing',
  ready: 'Installed — restarting',
  failed: 'Update failed',
  failedHint: "Couldn't download or install the new version — check your network connection and try again.",
  retry: 'Try again',
  close: 'Close',
  progressBytes: (downloaded: string, total: string | null) =>
    total ? `${downloaded} / ${total}` : downloaded,
};
