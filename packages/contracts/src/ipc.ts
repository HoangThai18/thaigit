import type { EnvProfile, ExecKind } from './policy.ts';

/**
 * Frame Raw gửi qua `Channel<InvokeResponseBody>` của lệnh `git_exec`. Byte đầu là tag:
 *  - `Stdout`: phần còn lại là một khối stdout (≤ 64 KB), nối theo thứ tự nhận.
 *  - `StderrLine`: một dòng stderr (tách theo `\r` hoặc `\n`, không kèm ký tự tách), giữ nguyên byte.
 *  - `Exit`: 4 byte mã thoát i32 little-endian + 1 byte `cancelled` (0/1). Luôn là frame cuối;
 *    phía TS chỉ resolve khi nhận frame này (lời gọi `invoke` có thể xong trước các frame cuối).
 */
export const FrameTag = {
  Stdout: 1,
  StderrLine: 2,
  Exit: 3,
} as const;
export type FrameTag = (typeof FrameTag)[keyof typeof FrameTag];

export const MAX_STDOUT_FRAME = 64 * 1024;

export interface ExitFrame {
  code: number;
  cancelled: boolean;
}

export function encodeExitFrame(exit: ExitFrame): Uint8Array {
  const frame = new Uint8Array(6);
  frame[0] = FrameTag.Exit;
  new DataView(frame.buffer).setInt32(1, exit.code, true);
  frame[5] = exit.cancelled ? 1 : 0;
  return frame;
}

export function decodeExitFrame(frame: Uint8Array): ExitFrame {
  if (frame.length !== 6 || frame[0] !== FrameTag.Exit) throw new Error('frame exit sai định dạng');
  return {
    code: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getInt32(1, true),
    cancelled: frame[5] === 1,
  };
}

/** Tham số lệnh `git_exec` (JSON). `stdin` là base64 (patch, danh sách path ngăn bằng NUL — luôn nhỏ). */
export interface GitExecRequest {
  repoId: string;
  opId: string;
  kind: ExecKind;
  sub: string;
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
  profile?: EnvProfile;
}

/** Kết quả `open_repo`: đường dẫn do Rust chuẩn hoá; `trust` = 'unknown' khi repo có cấu hình/hook chạy lệnh. */
export interface OpenedRepo {
  repoId: string;
  root: string;
  gitDir: string;
  commonDir: string;
  trust: 'trusted' | 'unknown';
  /** Các khoá cấu hình / hook đáng ngờ tìm thấy (để hiện cho người dùng khi hỏi tin tưởng). */
  findings: string[];
}

export type RepoChangeKind = 'workingTree' | 'refs' | 'rescan';

/** Sự kiện `repo-changed` của watcher. */
export interface RepoChangedEvent {
  repoId: string;
  kinds: RepoChangeKind[];
}

/** Lỗi chuẩn hoá từ Rust (invoke reject với object này). */
export interface CommandError {
  code:
    | 'policy'
    | 'not-found'
    | 'out-of-scope'
    | 'conflict'
    | 'busy'
    | 'io'
    | 'git-missing'
    | 'git-too-old'
    | 'untrusted'
    | 'internal';
  message: string;
}

/** Tên lệnh IPC (một chỗ cho TS; Rust đăng ký cùng tên trong `generate_handler!`). */
export const Commands = {
  pickRepoFolder: 'pick_repo_folder',
  openRepo: 'open_repo',
  trustRepo: 'trust_repo',
  listRecentRepos: 'list_recent_repos',
  forgetRecentRepo: 'forget_recent_repo',
  takeLaunchPaths: 'take_launch_paths',
  gitExec: 'git_exec',
  gitCancel: 'git_cancel',
  gitClone: 'git_clone',
  gitInit: 'git_init',
  gitConfigSet: 'git_config_set',
  gitRemoteAdd: 'git_remote_add',
  gitRemoteSetUrl: 'git_remote_set_url',
  repoHealth: 'repo_health',
  removeStaleLock: 'remove_stale_lock',
  fsReadGitFile: 'fs_read_git_file',
  fsReadWorktreeFile: 'fs_read_worktree_file',
  fsWriteWorktreeFile: 'fs_write_worktree_file',
  fsAppendGitignore: 'fs_append_gitignore',
  fsTrashUntracked: 'fs_trash_untracked',
  fsRestoreTrash: 'fs_restore_trash',
  watchRepo: 'watch_repo',
  unwatchRepo: 'unwatch_repo',
  gitLocate: 'git_locate',
  setGitPath: 'set_git_path',
  pickGitPath: 'pick_git_path',
  openInTerminal: 'open_in_terminal',
  openInEditor: 'open_in_editor',
  reveal: 'reveal',
  openUrl: 'open_url',
  sessionReset: 'session_reset',
  // Askpass (2b): webview trả lời hộp thoại hỏi mật khẩu/passphrase do `askpass-request` mở.
  askpassReply: 'askpass_reply',
  // Cập nhật tự động (8a) + chế độ an toàn: Rust làm hết, webview chỉ hiển thị/ra lệnh.
  updateCheck: 'update_check',
  updateInstall: 'update_install',
  updateSetChannel: 'update_set_channel',
  appReady: 'app_ready',
} as const;

export const Events = {
  repoChanged: 'repo-changed',
  gitEnvChanged: 'git-env-changed',
  askpassRequest: 'askpass-request',
  updateAvailable: 'update-available',
  updateProgress: 'update-progress',
} as const;

// MARK: - Askpass (2b)

/** Loại câu hỏi askpass (Rust phân loại prompt của git/ssh; webview chỉ hiển thị, không tin prompt thô). */
export type AskpassKind = 'username' | 'password' | 'passphrase' | 'other';

/**
 * Sự kiện `askpass-request`: git/ssh (hồ sơ `interactive`) cần một câu trả lời. UI hiện hộp thoại rồi gọi `askpass_reply` với
 * đúng `requestId`. `prompt` chỉ để hiển thị (Rust đã từ chối prompt có ký tự điều khiển); không bao giờ log prompt/câu trả lời.
 */
export interface AskpassRequestEvent {
  requestId: string;
  /** `opId` của lệnh `git_exec` đang chờ — để nút Huỷ trên BusyBar gắn đúng op. */
  opId: string;
  /** Tên thao tác hiện trên modal ("git push origin"). */
  operation: string;
  kind: AskpassKind;
  /** Host đã parse từ prompt (`github.com`), `null` nếu không có. */
  host: string | null;
  prompt: string;
}

/** Tham số `askpass_reply`: `answer = null` nghĩa là người dùng bấm Huỷ (git nhận mã thoát ≠ 0). */
export interface AskpassReply {
  requestId: string;
  answer: string | null;
}

// MARK: - Cập nhật tự động (8a)

/** Kênh cập nhật: manifest `latest.json` nằm trên release cố định `desktop-<kênh>` của GitHub. */
export type UpdateChannel = 'beta' | 'stable';

/** Một bản cập nhật hợp lệ (đã qua chữ ký + chống hạ cấp ở Rust). */
export interface UpdateInfo {
  currentVersion: string;
  version: string;
  /** Ghi chú phát hành (từ CHANGELOG), văn bản thường — chỉ render dạng text. */
  notes: string | null;
  /** RFC 3339, `null` nếu manifest không ghi. */
  pubDate: string | null;
}

/** Sự kiện `update-available`: Rust tự kiểm lúc khởi động + mỗi 6 giờ rồi báo cho UI. */
export interface UpdateAvailableEvent {
  update: UpdateInfo;
}

export type UpdatePhase = 'downloading' | 'verifying' | 'installing' | 'ready' | 'failed';

/** Sự kiện `update-progress` trong lúc `update_install` chạy. `total = null` khi chưa biết kích thước. */
export interface UpdateProgressEvent {
  phase: UpdatePhase;
  downloaded: number;
  total: number | null;
  /** Lý do khi `phase = 'failed'`. */
  message: string | null;
}
