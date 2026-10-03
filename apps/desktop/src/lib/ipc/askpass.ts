import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Commands, Events, type AskpassClosedEvent, type AskpassRequestEvent } from '@thaigit/contracts';
import { call } from './invoke.ts';

// Askpass tương tác: git/ssh cần tên đăng nhập / mật khẩu / passphrase → Rust hỏi cửa sổ sở hữu lệnh qua `askpass-request`,
// webview trả lời bằng `askpass_reply` (`null` = Huỷ). Không bao giờ log câu hỏi / câu trả lời.

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
