// Thaigit's own SSH keys: the secrets live only in Rust plus the OS keychain; the webview only ever sees the public key.
import type { SshKeysView, SshUploadResult } from '@thaigit/contracts';
import { Commands } from './commands.ts';
import { call } from './invoke.ts';

export function sshKeysList(): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysList);
}

/** Generate a new Ed25519 key. */
export function sshKeysGenerate(name: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysGenerate, { name });
}

/** Rust opens the key-file picker and does the import; `null` when the user cancels. */
export function sshKeysImport(): Promise<SshKeysView | null> {
  return call<SshKeysView | null>(Commands.sshKeysImport);
}

export function sshKeysRename(id: string, name: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysRename, { id, name });
}

export function sshKeysRemove(id: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysRemove, { id });
}

export function sshKeysSetEnabled(enabled: boolean): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysSetEnabled, { enabled });
}

/** Upload the public key to a signed-in account (`host` + `login`). */
export function sshKeysUpload(id: string, host: string, login: string): Promise<SshUploadResult> {
  return call<SshUploadResult>(Commands.sshKeysUpload, { id, host, login });
}

/** `ssh -T git@<host>` with Thaigit's key — returns the greeting on success. */
export function sshKeysTest(host: string): Promise<string> {
  return call<string>(Commands.sshKeysTest, { host });
}
