/**
 * "Host" = mọi thứ giao diện cần từ bên ngoài webview: mở repo (hộp thoại native / danh sách gần đây / "Mở bằng…") và
 * một repo đã mở (`exec`, `fs`, theo dõi thay đổi, tin tưởng). App thật dùng Tauri (`core-tauri.ts`, qua lõi Rust); khi chạy
 * dev trong trình duyệt thường thì dùng cầu nối dev CHỈ-ĐỌC (`dev-bridge-client.ts`, nạp bằng `import()` có điều kiện
 * `import.meta.env.DEV` để bản build không chứa nó). Phần còn lại của giao diện chỉ biết các kiểu ở đây.
 */
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import type { Exec, RepoFs, TypedGit } from '@thaigit/core';
import {
  createGitHost,
  listRecentRepos,
  forgetRecentRepo,
  openRepo,
  pickAndOpenRepo,
  takeLaunchFolders,
} from '../core-tauri.ts';
import { pickRepoFolder } from '../ipc/host.ts';
import type { PickedFolder, RecentRepo } from '../ipc/types.ts';

/** Phần của một repo đã mở mà giao diện dùng. `TauriRepo` thoả sẵn kiểu này. */
export interface RepoPort {
  readonly info: OpenedRepo;
  readonly exec: Exec;
  readonly fs: RepoFs;
  readonly typedGit?: TypedGit;
  /** Sự kiện đã debounce/lọc gitignore ở nơi phát (Rust) — người nhận KHÔNG debounce thêm. Trả hàm dừng. */
  watch(onChange: (event: RepoChangedEvent) => void): Promise<() => Promise<void>>;
  /** Ghi nhận tin tưởng; trả repo mới ở trạng thái `trusted`. */
  trust(): Promise<RepoPort>;
  /** Tích hợp hệ điều hành (chỉ có trong app Tauri): mở terminal / trình soạn thảo / trình quản lý file tại repo. */
  openInTerminal?(): Promise<void>;
  openInEditor?(relativePath?: string): Promise<void>;
  reveal?(relativePath?: string): Promise<void>;
}

export interface Host {
  readonly kind: 'tauri' | 'dev-bridge';
  /** Hộp thoại chọn thư mục rồi mở luôn; `null` = người dùng bấm Huỷ. */
  pickAndOpenRepo(): Promise<RepoPort | null>;
  openRecent(id: string): Promise<RepoPort>;
  listRecentRepos(): Promise<RecentRepo[]>;
  forgetRecentRepo(id: string): Promise<void>;
  /** Thư mục hệ điều hành đưa vào lúc khởi động (argv, "Mở bằng…"): mở cái đầu tiên, `null` nếu không có. */
  openLaunchRepo(): Promise<RepoPort | null>;
  /** Hộp thoại chọn thư mục (nơi đặt repo clone / tạo mới); `null` = Huỷ. */
  pickFolder(): Promise<PickedFolder | null>;
  /** Clone `url` vào thư mục con `name` của `folder`, xong thì mở (tin sẵn). Huỷ bằng `signal`. */
  cloneRepo(
    url: string,
    folder: PickedFolder,
    name: string,
    options: { onProgress?: (line: string) => void; signal?: AbortSignal },
  ): Promise<RepoPort>;
  /** Tạo repo mới trong thư mục con `name` của `folder` rồi mở. */
  initRepo(folder: PickedFolder, name: string): Promise<RepoPort>;
}

export function hasTauriInternals(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type OsFamily = 'mac' | 'windows' | 'other';

export function detectOs(): OsFamily {
  const platform = typeof navigator === 'undefined' ? '' : `${navigator.userAgent} ${navigator.platform}`;
  if (/Mac|iPhone|iPad/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'windows';
  return 'other';
}

export function createTauriHost(): Host {
  return {
    kind: 'tauri',
    pickAndOpenRepo: () => pickAndOpenRepo(),
    openRecent: (id) => openRepo({ kind: 'recent', id }),
    listRecentRepos: () => listRecentRepos(),
    forgetRecentRepo: (id) => forgetRecentRepo(id),
    async openLaunchRepo() {
      const [first] = await takeLaunchFolders();
      return first ? openRepo({ kind: 'picked', token: first.token }) : null;
    },
    pickFolder: () => pickRepoFolder(),
    cloneRepo: (url, folder, name, options) =>
      createGitHost().cloneRepo(url, `${folder.token}/${name}`, options),
    initRepo: (folder, name) => createGitHost().initRepo(`${folder.token}/${name}`),
  };
}

/**
 * Chọn host: trong Tauri luôn là Tauri. Chỉ khi chạy dev (`vite`) ngoài Tauri và plugin cầu nối có chèn token thì dùng cầu
 * nối dev. `import.meta.env.DEV` là hằng `false` khi build nên nhánh này (cùng `import()` bên trong) bị loại khỏi bản phát hành.
 */
export async function resolveHost(): Promise<Host> {
  if (import.meta.env.DEV && !hasTauriInternals()) {
    const { createDevBridgeHost } = await import('./dev-bridge-client.ts');
    const bridge = createDevBridgeHost();
    if (bridge) return bridge;
  }
  return createTauriHost();
}
