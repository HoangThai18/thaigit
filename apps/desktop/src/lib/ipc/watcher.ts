import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Commands, Events, type RepoChangedEvent } from '@thaigit/contracts';
import { call } from './invoke.ts';

/**
 * Theo dõi thay đổi của repo (debounce thích nghi + lọc gitignore + tắt tiếng khi app đang ghi đều ở Rust).
 * Nghe sự kiện TRƯỚC khi bật watcher để không bỏ lỡ sự kiện đầu. Trả hàm dừng.
 * Dùng `listen` của chính cửa sổ này: sự kiện `repo-changed` được Rust gửi theo nhãn cửa sổ.
 */
export async function watchRepo(
  repoId: string,
  onChange: (event: RepoChangedEvent) => void,
): Promise<() => Promise<void>> {
  const unlisten = await getCurrentWebviewWindow().listen<RepoChangedEvent>(Events.repoChanged, (event) => {
    if (event.payload.repoId === repoId) onChange(event.payload);
  });
  try {
    await call<void>(Commands.watchRepo, { repoId });
  } catch (error) {
    unlisten();
    throw error;
  }
  return async () => {
    unlisten();
    await call<void>(Commands.unwatchRepo, { repoId });
  };
}

/** Rust phát `git-env-changed` khi đổi/tìm lại git (vd. PATH của login shell nạp xong). Trả hàm huỷ nghe. */
export async function onGitEnvChanged(handler: () => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen(Events.gitEnvChanged, () => handler());
}
