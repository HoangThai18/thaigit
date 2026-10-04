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

/** Thao tác cho một commit trong rebase tương tác (pick / reword / squash / fixup / drop). */
export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

/**
 * Một dòng kế hoạch của `git_rebase_interactive` (xếp cũ → mới). `sha` phải là sha đầy đủ; `message` chỉ dùng với `reword`.
 * Rust tự soạn file todo từ đây — webview không bao giờ gửi todo thô (dòng `exec` chạy lệnh shell).
 */
export interface RebaseStepRequest {
  action: RebaseAction;
  sha: string;
  message?: string;
}

/** Kết quả `git_rebase_interactive`: mã thoát ≠ 0 khi git dừng giữa chừng (xung đột, commit rỗng…). */
export interface RebaseResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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
    | 'auth'
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
  gitRebaseInteractive: 'git_rebase_interactive',
  repoHealth: 'repo_health',
  removeStaleLock: 'remove_stale_lock',
  fsReadGitFile: 'fs_read_git_file',
  fsReadWorktreeFile: 'fs_read_worktree_file',
  fsWriteWorktreeFile: 'fs_write_worktree_file',
  fsAppendGitignore: 'fs_append_gitignore',
  fsTrashUntracked: 'fs_trash_untracked',
  fsRestoreTrash: 'fs_restore_trash',
  fsSnapshotIndexPrepare: 'fs_snapshot_index_prepare',
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
  // Cửa sổ thêm (Ctrl/⌘+T) để làm việc với repo khác song song.
  newWindow: 'new_window',
  // Ngôn ngữ giao diện cho chữ do Rust tự hiện (hộp chọn thư mục, chế độ an toàn).
  appSetLocale: 'app_set_locale',
  // Tài khoản git: token trong kho bí mật của hệ điều hành, chọn theo owner của repo.
  accountsList: 'accounts_list',
  accountsAddToken: 'accounts_add_token',
  accountsStartLogin: 'accounts_start_login',
  accountsPollLogin: 'accounts_poll_login',
  accountsCancelLogin: 'accounts_cancel_login',
  accountsRemove: 'accounts_remove',
  accountsSetDefault: 'accounts_set_default',
  accountsAssignOwner: 'accounts_assign_owner',
  accountsSetIdentity: 'accounts_set_identity',
  accountsSetClientId: 'accounts_set_client_id',
  accountsRepositories: 'accounts_repositories',
  // Pull Request (GitHub / Bitbucket) và Merge Request (GitLab).
  forgeListMergeRequests: 'forge_list_merge_requests',
  forgeCreateMergeRequest: 'forge_create_merge_request',
} as const;

export const Events = {
  repoChanged: 'repo-changed',
  gitEnvChanged: 'git-env-changed',
  askpassRequest: 'askpass-request',
  askpassClosed: 'askpass-closed',
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

/** Sự kiện `askpass-closed`: câu hỏi hết hiệu lực (lệnh đã xong / bị huỷ / quá 10 phút) — đóng hộp thoại, không trả lời nữa. */
export interface AskpassClosedEvent {
  requestId: string;
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

// MARK: - Tài khoản & Pull Request

export type ForgeProvider = 'github' | 'gitlab' | 'bitbucket';

/** Máy chủ mà app hiểu ngay (host khác phải tự chọn provider). */
export const KNOWN_FORGE_HOSTS: Readonly<Record<ForgeProvider, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

export interface ForgeAccount {
  host: string;
  provider: ForgeProvider;
  /** Id của tài khoản ở máy chủ (GitHub dùng cho email ẩn). */
  id: string;
  login: string;
  displayName: string;
  commitName: string;
  commitEmail: string;
  /** Tổ chức / nhóm / workspace — dùng chọn token theo owner. */
  organizations: string[];
  /** Token có trong kho bí mật của hệ điều hành không (token không bao giờ đi qua IPC). */
  hasToken: boolean;
}

/** Lý do app chọn tài khoản này cho owner đó. */
export type ForgeMatchReason = 'assigned' | 'login' | 'organization' | 'fallback';

export interface AccountsView {
  accounts: ForgeAccount[];
  /** host → login của tài khoản mặc định đang hiệu lực. */
  defaults: Record<string, string>;
  /** `host/owner` → login do người dùng tự gán. */
  ownerAssignments: Record<string, string>;
  /** host → Client ID của OAuth App (device flow); thiếu thì chỉ dán được token. */
  oauthClientIds: Record<string, string>;
}

export interface ForgeRepository {
  host: string;
  /** `owner/repo` (GitLab có thể `group/sub/repo`). */
  path: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  webUrl: string;
  /** URL clone HTTPS không kèm token (token đi qua credential helper của app). */
  cloneUrl: string;
}

/** Pull Request (GitHub / Bitbucket) hoặc Merge Request (GitLab). */
export interface ForgeMergeRequest {
  host: string;
  /** Số PR (GitHub) hoặc iid (GitLab / Bitbucket). */
  number: string;
  title: string;
  body: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  draft: boolean;
  webUrl: string;
  /** Nhánh PR nằm ở repo khác (fork) thì `headHost` khác `host`. */
  headHost: string;
  headOwner: string;
  updatedAt: string;
  commits: number | null;
}

/** Mã để người dùng nhập ở trang đăng nhập của máy chủ (OAuth device flow). */
export interface ForgeDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  /** Bí mật tạm của RFC 8628: webview giữ để hỏi token, hết hiệu lực cùng mã người dùng nhập. */
  deviceCode: string;
}
