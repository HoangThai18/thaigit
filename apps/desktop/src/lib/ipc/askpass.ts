import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Commands, Events, type AskpassClosedEvent, type AskpassRequestEvent } from '@thaigit/contracts';
import { call } from './invoke.ts';

// Interactive askpass: when git/ssh needs a login / password / passphrase, Rust asks the window that owns
// the command over `askpass-request` and the webview answers with `askpass_reply` (`null` = Cancel). The
// question and the answer are never logged.

export function askpassReply(requestId: string, answer: string | null): Promise<void> {
  return call<void>(Commands.askpassReply, { requestId, answer });
}

export async function onAskpassRequest(handler: (event: AskpassRequestEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<AskpassRequestEvent>(Events.askpassRequest, (event) =>
    handler(event.payload),
  );
}

export async function onAskpassClosed(handler: (event: AskpassClosedEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<AskpassClosedEvent>(Events.askpassClosed, (event) =>
    handler(event.payload),
  );
}
