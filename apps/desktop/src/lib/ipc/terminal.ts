// A real terminal inside the repo window: Rust runs the machine's shell over a PTY in the repo directory;
// the webview only picks the repo, sends keystrokes and sizes, and receives raw output bytes via a Channel.
import { Channel } from '@tauri-apps/api/core';
import type { TerminalEvent } from '@thaigit/contracts';
import { Commands } from './commands.ts';
import { call } from './invoke.ts';

export interface TerminalHandlers {
  ondata: (bytes: Uint8Array) => void;
  onexit: () => void;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Open a shell at the repo's root directory; returns the session id. */
export function terminalOpen(
  repoId: string,
  cols: number,
  rows: number,
  handlers: TerminalHandlers,
): Promise<string> {
  const channel = new Channel<TerminalEvent>((event) => {
    if (event.kind === 'data') handlers.ondata(decodeBase64(event.data));
    else handlers.onexit();
  });
  return call<string>(Commands.terminalOpen, { repoId, cols, rows, channel });
}

export function terminalWrite(id: string, data: string): Promise<void> {
  return call<void>(Commands.terminalWrite, { id, data });
}

export function terminalResize(id: string, cols: number, rows: number): Promise<void> {
  return call<void>(Commands.terminalResize, { id, cols, rows });
}

export function terminalClose(id: string): Promise<void> {
  return call<void>(Commands.terminalClose, { id });
}
