/**
 * Bộ chuyển Tauri cho các port của `@thaigit/core`: `Exec`, `RepoFs`, `GitHost`, `TypedGit` — tất cả đi qua lõi Rust,
 * nơi kiểm chính sách (cờ `-c`, env, allowlist, phạm vi đường dẫn). Webview không bao giờ đặt đường dẫn/cờ/env tuỳ ý.
 *
 * Cách dùng:
 * ```ts
 * const folder = await pickRepoFolder();                       // hộp thoại native → token
 * const repo = await openRepo({ kind: 'picked', token: folder.token });
 * while (repo.info.trust === 'unknown') { … hiện repo.info.findings, hỏi người dùng … repo = await repo.trust(); }
 * const result = await repo.exec.run({ kind: 'read', sub: 'status', args: ['--porcelain=v2', '-z'] });
 * const bytes = await repo.fs.readWorktreeFile('src/a.ts');
 * ```
 */
import type { OpenedRepo, RepoChangedEvent } from '@thaigit/contracts';
import type { Exec, GitHost, RepoFs, TypedGit } from '@thaigit/core';
import {
  type CloneOptions,
  type OpenSource,
  type RepoHealth,
  cloneRepoInfo,
  configSet,
  createRepoFs,
  initRepoInfo,
  locateGit,
  openInEditor,
  openInTerminal,
  openRepoInfo,
  pickRepoFolder,
  remoteAdd,
  remoteSetUrl,
  removeStaleLock,
  repoHealth,
  reveal,
  runGit,
  trustRepoInfo,
  watchRepo,
} from './ipc/index.ts';

export type {
  CloneOptions,
  GitInfo,
  LockFile,
  OpenSource,
  PickedFolder,
  RecentRepo,
  RepoHealth,
  RepoOperationKind,
} from './ipc/index.ts';
export {
  CommandFailure,
  forgetRecentRepo,
  isCommandFailure,
  listRecentRepos,
  locateGit,
  onGitEnvChanged,
  openUrl,
  pickGitPath,
  pickRepoFolder,
  sessionReset,
  setGitPath,
  takeLaunchFolders,
} from './ipc/index.ts';

/** Một repo đã mở trong lõi Rust, gắn sẵn các port. */
export interface TauriRepo {
  readonly info: OpenedRepo;
  /** `Exec` của repo: `kind` read/write/network, khoá theo repo, huỷ theo bậc cho `network`. */
  readonly exec: Exec;
  readonly fs: RepoFs;
  /** Lệnh git có kiểu: `configSet` (khoá trong allowlist), `remoteAdd`/`remoteSetUrl` (URL đã kiểm). */
  readonly typedGit: TypedGit;
  /** Theo dõi thay đổi (đã debounce/lọc gitignore ở Rust). Trả hàm dừng. */
  watch(onChange: (event: RepoChangedEvent) => void): Promise<() => Promise<void>>;
  health(): Promise<RepoHealth>;
  /** Chỉ gọi sau khi người dùng xác nhận gỡ khoá do `health()` báo. */
  removeStaleLock(path: string): Promise<void>;
  /**
   * Ghi nhận tin tưởng (repo có khoá cấu hình/hook chạy lệnh) — CHỈ cho danh sách `info.findings` mà người dùng đã thấy. Nếu cấu
   * hình hiệu lực đã đổi kể từ đó (vd. chuyển nhánh ở terminal kéo vào file `include` khác) thì repo trả về VẪN `unknown` và
   * `info.findings` là danh sách MỚI: hiện lại cho người dùng rồi gọi `trust()` lần nữa. Khi chưa tin cậy, lệnh có thể chạy lệnh
   * do cấu hình chỉ định bị từ chối với mã `untrusted` (UI → "Tin tưởng repo để tiếp tục").
   */
  trust(): Promise<TauriRepo>;
  openInTerminal(): Promise<void>;
  openInEditor(relativePath?: string): Promise<void>;
  reveal(relativePath?: string): Promise<void>;
}

/** `TypedGit` của một repo. */
export function createTypedGit(repoId: string): TypedGit {
  return {
    configSet: (key, value, scope) => configSet(repoId, key, value, scope),
    remoteAdd: (name, url) => remoteAdd(repoId, name, url),
    remoteSetUrl: (name, url) => remoteSetUrl(repoId, name, url),
  };
}

/** Gắn các port vào kết quả `open_repo`. */
export function bindRepo(info: OpenedRepo): TauriRepo {
  const { repoId } = info;
  return {
    info,
    exec: { run: (request) => runGit(repoId, request) },
    fs: createRepoFs(repoId),
    typedGit: createTypedGit(repoId),
    watch: (onChange) => watchRepo(repoId, onChange),
    health: () => repoHealth(repoId),
    removeStaleLock: (path) => removeStaleLock(repoId, path),
    trust: async () => bindRepo(await trustRepoInfo(repoId)),
    openInTerminal: () => openInTerminal(repoId),
    openInEditor: (relativePath) => openInEditor(repoId, relativePath),
    reveal: (relativePath) => reveal(repoId, relativePath),
  };
}

/** Mở repo từ token (hộp thoại/"Mở bằng"/thả file native) hoặc danh sách gần đây do Rust lưu. */
export async function openRepo(source: OpenSource): Promise<TauriRepo> {
  return bindRepo(await openRepoInfo(source));
}

/** Hộp thoại chọn thư mục rồi mở luôn. `null` = người dùng bấm Huỷ. */
export async function pickAndOpenRepo(): Promise<TauriRepo | null> {
  const folder = await pickRepoFolder();
  return folder ? openRepo({ kind: 'picked', token: folder.token }) : null;
}

/** `GitHost` trên Tauri; `destination` là mã thư mục native (`token`) hoặc `token/tên-thư-mục-con`. */
export interface TauriGitHost extends GitHost {
  /** Như `clone` nhưng trả repo đã mở (tin sẵn) thay vì `void`. */
  cloneRepo(url: string, destination: string, options?: CloneOptions): Promise<TauriRepo>;
  /** Như `init` nhưng trả repo đã mở (tin sẵn). */
  initRepo(destination: string): Promise<TauriRepo>;
}

export function createGitHost(): TauriGitHost {
  return {
    version: async () => (await locateGit()).version,
    async init(destination) {
      await initRepoInfo(destination);
    },
    async clone(url, destination, options) {
      await cloneRepoInfo(url, destination, options);
    },
    async cloneRepo(url, destination, options) {
      return bindRepo(await cloneRepoInfo(url, destination, options));
    },
    async initRepo(destination) {
      return bindRepo(await initRepoInfo(destination));
    },
  };
}
