import { Commands, type OpenedRepo } from '@thaigit/contracts';
import { call } from './invoke.ts';
import type { GitInfo, OpenSource, PickedFolder, RecentRepo, RepoHealth } from './types.ts';

/** Repo trên github.com: `owner` + `name` (Rust ghép thành URL, không nhận URL thô từ webview). */
export interface GithubRepoRef {
  readonly owner: string;
  readonly name: string;
}

// --- chọn thư mục / mở repo (đường dẫn chỉ đến từ Rust: hộp thoại native, "Mở bằng", danh sách gần đây) ---------------

/** Hộp thoại native chọn thư mục. `null` = người dùng bấm Huỷ. Dùng token trả về cho `openRepo` / `cloneRepo` / `initRepo`. */
export function pickRepoFolder(): Promise<PickedFolder | null> {
  return call<PickedFolder | null>(Commands.pickRepoFolder);
}

export function openRepoInfo(source: OpenSource): Promise<OpenedRepo> {
  return call<OpenedRepo>(Commands.openRepo, { source });
}

export function trustRepoInfo(repoId: string): Promise<OpenedRepo> {
  return call<OpenedRepo>(Commands.trustRepo, { repoId });
}

export function listRecentRepos(): Promise<RecentRepo[]> {
  return call<RecentRepo[]>(Commands.listRecentRepos);
}

export function forgetRecentRepo(id: string): Promise<void> {
  return call<void>(Commands.forgetRecentRepo, { id });
}

/** Thư mục hệ điều hành đưa vào lúc khởi động (argv / "Mở bằng"): lấy một lần, dạng token. */
export function takeLaunchFolders(): Promise<PickedFolder[]> {
  return call<PickedFolder[]>(Commands.takeLaunchPaths);
}

// --- sức khoẻ repo ------------------------------------------------------------------------------------------------------

export function repoHealth(repoId: string): Promise<RepoHealth> {
  return call<RepoHealth>(Commands.repoHealth, { repoId });
}

/** Gỡ khoá mồ côi do `repoHealth` báo — chỉ gọi sau khi người dùng xác nhận. */
export function removeStaleLock(repoId: string, path: string): Promise<void> {
  return call<void>(Commands.removeStaleLock, { repoId, path });
}

/**
 * Ảnh đại diện người commit dạng data URL (`null` = không có ảnh / không tải được). Rust tải và cache; webview
 * không tự gọi mạng được nên phải đi qua IPC. `github` là repo trên github.com của repo đang mở (thiếu thì bỏ
 * qua nguồn API GitHub) — Rust tự dựng URL và tự chọn token.
 */
export function avatarLookup(email: string, github: GithubRepoRef | null): Promise<string | null> {
  return call<string | null>(Commands.avatarLookup, {
    email,
    owner: github?.owner ?? null,
    repo: github?.name ?? null,
  });
}

// --- git (định vị) ------------------------------------------------------------------------------------------------------

export function locateGit(): Promise<GitInfo> {
  return call<GitInfo>(Commands.gitLocate);
}

/** `null` = tự tìm. Chỉ nhận một trong `GitInfo.candidates` (Rust không cho webview trỏ git tới file tuỳ ý). */
export function setGitPath(path: string | null): Promise<GitInfo> {
  return call<GitInfo>(Commands.setGitPath, { path });
}

/** Chọn file git bằng hộp thoại native. `null` = Huỷ. */
export function pickGitPath(): Promise<GitInfo | null> {
  return call<GitInfo | null>(Commands.pickGitPath);
}

/** Webview mới tải xong: huỷ op con và bỏ watcher của phiên cũ (Rust cũng tự làm khi trang tải lại). */
export function sessionReset(): Promise<void> {
  return call<void>(Commands.sessionReset);
}
