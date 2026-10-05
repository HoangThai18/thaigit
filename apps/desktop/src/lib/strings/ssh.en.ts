/** English translation of `ss.vi.ts` (same keys, same parameters). */
import type { ssh as sshSource } from './ssh.vi.ts';
import type { Translation } from './types.ts';

export const ssh: Translation<typeof sshSource> = {
  title: 'SSH keys',
  help: 'Create an SSH key right in Thaigit (or import an existing one) to clone / fetch / push SSH repositories (git@github.com:…, git@gitlab.com:…) without setting up ssh-agent or a .ssh folder.',
  vaultHelp:
    "Private keys live only in this computer's secret store (Credential Manager on Windows, Keychain on macOS) and are never written to files. When a git command needs one, Thaigit loads it into a temporary ssh-agent just for that command, then shuts it down.",
  empty: 'No SSH keys yet.',
  generate: 'New key',
  generateTitle: 'New SSH key',
  generateMessage:
    "An Ed25519 key (the type GitHub and GitLab recommend). Name it after this computer so it's easy to recognize on GitHub / GitLab.",
  namePlaceholder: 'Key name',
  import: 'Import existing key…',
  copy: 'Copy public key',
  uploadTo: (login: string, host: string) => `Add to ${host} @${login}`,
  rename: 'Rename',
  renameTitle: 'Rename key',
  remove: 'Delete key',
  removeConfirm: (name: string) =>
    `Delete key “${name}”? The private key is permanently deleted from this computer and can't be recovered — SSH repositories using it will no longer fetch / push.`,
  encrypted: 'Passphrase',
  encryptedHelp: 'Passphrase-protected key — Thaigit asks for the passphrase each time it is used',
  created: (date: string) => `Created ${date}`,
  enabled: 'Use Thaigit keys for SSH remotes',
  enabledHelp: 'When off, git uses your ssh-agent and the keys in your .ssh folder, just like in a terminal.',
  test: 'Test connection',
  testing: 'Testing…',
  testOk: (host: string) => `Connected to ${host} with Thaigit's keys.`,
  testFailed: (host: string) =>
    `${host} doesn't accept any of Thaigit's keys yet — add the public key to your account first, or check your network (port 22).`,
  generatedToast: (name: string) => `Created key “${name}”. Add its public key to GitHub / GitLab to use it.`,
  importedToast: "Imported the key into this computer's secret store.",
  copiedToast: 'Copied the public key.',
  removedToast: (name: string) =>
    `Deleted key “${name}”. Remember to remove its public key on GitHub / GitLab if you no longer use it.`,
  uploadedToast: (host: string) => `Added the key to ${host}.`,
  existsToast: (host: string) => `This key is already on ${host}.`,
  missingScopeToast: (host: string) =>
    `Your ${host} account hasn't allowed Thaigit to add SSH keys. The key was copied and the add-key page opened — paste it there.`,
  errors: {
    invalid:
      "This file isn't a private SSH key Thaigit can read — choose the private key file (e.g. id_ed25519), not the .pub file.",
    duplicate: 'This SSH key is already in Thaigit.',
    vault: "Couldn't open the operating system's secret store — unlock it and try again.",
    agent:
      "Couldn't start ssh-agent on this computer (Git for Windows is required), so Thaigit's SSH keys can't be used yet.",
  },
};
