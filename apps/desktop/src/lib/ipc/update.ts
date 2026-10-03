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

// Cập nhật tự động: mọi quyết định (kênh, phiên bản hợp lệ, chữ ký, khi nào cài) nằm ở Rust; webview chỉ hỏi và nghe.

/** Kiểm bản mới của kênh hiện tại; `null` = đang ở bản mới nhất. */
export function updateCheck(): Promise<UpdateInfo | null> {
  return call<UpdateInfo | null>(Commands.updateCheck);
}

/** Tải + kiểm chữ ký + cài bản `updateCheck` vừa báo; app tự khởi động lại (Windows: trình cài chạy rồi app thoát). */
export function updateInstall(): Promise<void> {
  return call<void>(Commands.updateInstall);
}

export function updateSetChannel(channel: UpdateChannel): Promise<void> {
  return call<void>(Commands.updateSetChannel, { channel });
}

/** Báo Rust giao diện đã dựng xong (chế độ an toàn đếm khởi động hỏng). */
export function appReady(): Promise<void> {
  return call<void>(Commands.appReady);
}

export async function onUpdateAvailable(handler: (event: UpdateAvailableEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<UpdateAvailableEvent>(Events.updateAvailable, (event) => handler(event.payload));
}

export async function onUpdateProgress(handler: (event: UpdateProgressEvent) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<UpdateProgressEvent>(Events.updateProgress, (event) => handler(event.payload));
}
