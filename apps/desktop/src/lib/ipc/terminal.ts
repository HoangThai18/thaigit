// Terminal thật trong cửa sổ repo: Rust chạy shell của máy qua PTY ở thư mục repo; webview chỉ chọn repo, gửi phím gõ và
// kích thước, nhận output (byte thô) qua Channel.
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

/** Mở shell ở thư mục gốc của repo; trả id phiên. */
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
