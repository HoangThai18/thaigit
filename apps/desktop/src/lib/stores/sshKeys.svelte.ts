// Thaigit's own SSH keys: the store holds the `SshKeysView` Rust returns (the single source of truth). A secret key never
// reaches the webview, and errors are only shown as a friendly sentence per Rust's error code.

import type { SshKeysView, SshUploadResult } from '@thaigit/contracts';
import {
  sshKeysGenerate,
  sshKeysImport,
  sshKeysList,
  sshKeysRemove,
  sshKeysRename,
  sshKeysSetEnabled,
  sshKeysTest,
  sshKeysUpload,
} from '../ipc/sshKeys.ts';
import { vi } from '../strings.vi.ts';

const EMPTY: SshKeysView = { keys: [], enabled: true };

export interface SshKeysPort {
  list(): Promise<SshKeysView>;
  generate(name: string): Promise<SshKeysView>;
  importKey(): Promise<SshKeysView | null>;
  rename(id: string, name: string): Promise<SshKeysView>;
  remove(id: string): Promise<SshKeysView>;
  setEnabled(enabled: boolean): Promise<SshKeysView>;
  upload(id: string, host: string, login: string): Promise<SshUploadResult>;
  test(host: string): Promise<string>;
}

export const defaultSshKeysPort: SshKeysPort = {
  list: sshKeysList,
  generate: sshKeysGenerate,
  importKey: sshKeysImport,
  rename: sshKeysRename,
  remove: sshKeysRemove,
  setEnabled: sshKeysSetEnabled,
  upload: sshKeysUpload,
  test: sshKeysTest,
};

/** A friendly sentence for an SSH key command error (per Rust's error code, never the raw message). */
export function sshErrorText(error: unknown): string {
  const text = vi.ssh.errors;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'policy') return text.invalid;
  if (code === 'conflict') return text.duplicate;
  if (code === 'auth') return text.vault;
  if (code === 'io') return text.agent;
  return vi.errors.friendly.unexpected;
}

export class SshKeysStore {
  view = $state.raw<SshKeysView>(EMPTY);
  busy = $state(false);
  error = $state<string | null>(null);
  /** host → the most recent connection-check result. */
  tests = $state.raw<Record<string, 'testing' | 'ok' | 'failed'>>({});

  constructor(private readonly port: SshKeysPort = defaultSshKeysPort) {}

  private async run<T>(action: () => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = null;
    try {
      return await action();
    } catch (error) {
      this.error = sshErrorText(error);
      return null;
    } finally {
      this.busy = false;
    }
  }

  private apply(view: SshKeysView | null): boolean {
    if (view === null) return false;
    this.view = view;
    return true;
  }

  async refresh(): Promise<void> {
    this.apply(await this.run(() => this.port.list()));
  }

  async generate(name: string): Promise<boolean> {
    return this.apply(await this.run(() => this.port.generate(name)));
  }

  /** `true` once imported (cancelling the file picker gives `false`, which is not an error). */
  async importKey(): Promise<boolean> {
    return this.apply(await this.run(() => this.port.importKey()));
  }

  async rename(id: string, name: string): Promise<boolean> {
    return this.apply(await this.run(() => this.port.rename(id, name)));
  }

  async remove(id: string): Promise<boolean> {
    return this.apply(await this.run(() => this.port.remove(id)));
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.apply(await this.run(() => this.port.setEnabled(enabled)));
  }

  upload(id: string, host: string, login: string): Promise<SshUploadResult | null> {
    return this.run(() => this.port.upload(id, host, login));
  }

  async test(host: string): Promise<void> {
    this.tests = { ...this.tests, [host]: 'testing' };
    let result: 'ok' | 'failed';
    try {
      await this.port.test(host);
      result = 'ok';
    } catch {
      result = 'failed';
    }
    this.tests = { ...this.tests, [host]: result };
  }
}

export const sshKeys = new SshKeysStore();
