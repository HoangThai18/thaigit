import type { EnvProfile, ExecKind } from './policy.ts';

/**
 * Raw frame sent over `git_exec`'s `Channel<InvokeResponseBody>`. The first byte is a tag:
 *  - `Stdout`: the rest is one stdout chunk (≤ 64 KB), concatenated in arrival order.
 *  - `StderrLine`: one stderr line (split on `\r` or `\n`, separator not included), bytes preserved.
 *  - `Exit`: 4-byte little-endian i32 exit code + 1 `cancelled` byte (0/1). Always the last frame; TS only resolves
 *    once it arrives, because the `invoke` call itself may settle before the trailing frames do.
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

/** `git_exec` params (JSON). `stdin` is base64 (patches, NUL-separated path lists — always small). */
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

/** `open_repo` result: the path is normalised by Rust; `trust` is 'unknown' when the repo has config or hooks that run commands. */
export interface OpenedRepo {
  repoId: string;
  root: string;
  gitDir: string;
  commonDir: string;
  trust: 'trusted' | 'unknown';
  /** Suspicious config keys / hooks found, so the UI can list them in the trust prompt. */
  findings: string[];
}

export type RepoChangeKind = 'workingTree' | 'refs' | 'rescan';

/** Watcher `repo-changed` event. */
export interface RepoChangedEvent {
  repoId: string;
  kinds: RepoChangeKind[];
}

/** Action for one commit in an interactive rebase (pick / reword / squash / fixup / drop). */
export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

/**
 * One line of the `git_rebase_interactive` plan (oldest first). `sha` must be a full sha; `message` is only used with
 * `reword`. Rust composes the todo file from this — the webview never sends raw todo lines (an `exec` line would run a shell).
 */
export interface RebaseStepRequest {
  action: RebaseAction;
  sha: string;
  message?: string;
}

/** `git_rebase_interactive` result: a non-zero exit code means git stopped part-way (conflict, empty commit…). */
export interface RebaseResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Normalised error from Rust (the invoke rejects with this object). */
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

/** IPC command name (single source for TS; Rust registers the same name in `generate_handler!`). */
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
  gitWorktreeAdd: 'git_worktree_add',
  openRelatedRepo: 'open_related_repo',
  repoHealth: 'repo_health',
  avatarLookup: 'avatar_lookup',
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
  // Askpass (2b): the webview answers the password / passphrase prompt that `askpass-request` opens.
  askpassReply: 'askpass_reply',
  // Auto-update (8a) and safe mode: Rust does the work, the webview only displays and commands.
  updateCheck: 'update_check',
  updateInstall: 'update_install',
  updateSetChannel: 'update_set_channel',
  appReady: 'app_ready',
  // Extra window (Ctrl/⌘+T) to work with another repo in parallel. */
  newWindow: 'new_window',
  // UI language for the text Rust renders itself (folder picker, safe-mode notice).
  appSetLocale: 'app_set_locale',
  // Git accounts: token lives in the OS keystore, selected by the repo's owner.
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
  // Real terminal inside the repo window (PTY owned by Rust; the webview only sends keystrokes and size).
  terminalOpen: 'terminal_open',
  terminalWrite: 'terminal_write',
  terminalResize: 'terminal_resize',
  terminalClose: 'terminal_close',
  // Thaigit-managed SSH key (the secret stays in Rust plus the OS keystore).
  sshKeysList: 'ssh_keys_list',
  sshKeysGenerate: 'ssh_keys_generate',
  sshKeysImport: 'ssh_keys_import',
  sshKeysRename: 'ssh_keys_rename',
  sshKeysRemove: 'ssh_keys_remove',
  sshKeysSetEnabled: 'ssh_keys_set_enabled',
  sshKeysUpload: 'ssh_keys_upload',
  sshKeysTest: 'ssh_keys_test',
  // Pull Requests (GitHub / Bitbucket) and Merge Requests (GitLab). */
  forgeListMergeRequests: 'forge_list_merge_requests',
  forgeCreateMergeRequest: 'forge_create_merge_request',
  // PR / MR reviewer and assignee. */
  forgeListAssignable: 'forge_list_assignable',
  forgeSetPeople: 'forge_set_people',
  // PR / MR review actions (comment / approve / merge) run in the Rust core, never from the webview directly.
  forgeAddComment: 'forge_add_comment',
  forgeApprove: 'forge_approve',
  forgeMerge: 'forge_merge',
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

/** Askpass question kind (Rust classifies the git/ssh prompt; the webview only renders it and never trusts the raw prompt). */
export type AskpassKind = 'username' | 'password' | 'passphrase' | 'other';

/**
 * `askpass-request` event: git/ssh (under the `interactive` profile) needs an answer. The UI shows a dialog and calls
 * `askpass_reply` with the matching `requestId`. `prompt` is display-only (Rust already rejected prompts containing
 * control characters); prompts and answers are never logged.
 */
export interface AskpassRequestEvent {
  requestId: string;
  /** `opId` of the awaiting `git_exec` call, so the BusyBar Cancel button attaches to the right operation. */
  opId: string;
  /** Operation name shown on the modal ("git push origin"). */
  operation: string;
  kind: AskpassKind;
  /** Host parsed from the prompt (`github.com`), null when absent. */
  host: string | null;
  prompt: string;
}

/** `askpass-closed` event: the question expired (command finished / was cancelled / passed 10 minutes) — close the dialog and stop answering. */
export interface AskpassClosedEvent {
  requestId: string;
}

/** `askpass_reply` params: `answer = null` means the user pressed Cancel (git then sees a non-zero exit code). */
export interface AskpassReply {
  requestId: string;
  answer: string | null;
}

// MARK: - Auto-update (8a)

/** Update channel: the manifest `latest.json` lives on the fixed `desktop-<channel>` GitHub release. */
export type UpdateChannel = 'beta' | 'stable';

/** A valid update (signature and downgrade protection already verified in Rust). */
export interface UpdateInfo {
  currentVersion: string;
  version: string;
  /** Release notes (from CHANGELOG), plain text — render as text only. */
  notes: string | null;
  /** RFC 3339, `null` when the manifest omits it. */
  pubDate: string | null;
}

/** `update-available` event: Rust checks at startup and every 6 hours, then reports to the UI. */
export interface UpdateAvailableEvent {
  update: UpdateInfo;
}

export type UpdatePhase = 'downloading' | 'verifying' | 'installing' | 'ready' | 'failed';

/** `update-progress` event while `update_install` runs. `total = null` while the size is still unknown. */
export interface UpdateProgressEvent {
  phase: UpdatePhase;
  downloaded: number;
  total: number | null;
  /** Reason when `phase = 'failed'`. */
  message: string | null;
}

// MARK: - Accounts & pull requests

export type ForgeProvider = 'github' | 'gitlab' | 'bitbucket';

/** Hosts the app recognises outright (other hosts require picking a provider). */
export const KNOWN_FORGE_HOSTS: Readonly<Record<ForgeProvider, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

export interface ForgeAccount {
  host: string;
  provider: ForgeProvider;
  /** Account id on the server (GitHub uses it for private email addresses). */
  id: string;
  login: string;
  displayName: string;
  commitName: string;
  commitEmail: string;
  /** Organisation / group / workspace — used to pick the token by owner. */
  organizations: string[];
  /** Whether a token exists in the OS keystore (tokens never cross IPC). */
  hasToken: boolean;
}

/** Why the app picked this account for that owner. */
export type ForgeMatchReason = 'assigned' | 'login' | 'organization' | 'fallback';

export interface AccountsView {
  accounts: ForgeAccount[];
  /** host → login of the account currently in effect. */
  defaults: Record<string, string>;
  /** `host/owner` → login assigned by the user. */
  ownerAssignments: Record<string, string>;
  /** host → OAuth App client id (device flow); without it only pasted tokens work. */
  oauthClientIds: Record<string, string>;
}

/** Terminal event: output (base64) or shell exit. */
export type TerminalEvent = { kind: 'data'; data: string } | { kind: 'exit' };

/** One Thaigit-managed SSH key — the private key never crosses IPC. */
export interface SshKeyInfo {
  id: string;
  name: string;
  /** Public key line "ssh-ed25519 AAAA… comment". */
  publicKey: string;
  /** "SHA256:…" as printed by `ssh-keygen -l`. */
  fingerprint: string;
  keyType: string;
  /** Key has a passphrase: ssh-add asks for it through the app's dialog every time the key is used. */
  encrypted: boolean;
  createdAt: string;
}

export interface SshKeysView {
  keys: SshKeyInfo[];
  /** Use this Thaigit key for the SSH remote. */
  enabled: boolean;
}

export type SshKeyUploadOutcome = 'added' | 'alreadyExists' | 'missingScope';

export interface SshUploadResult {
  outcome: SshKeyUploadOutcome;
  /** Add a key manually on the server side (when the token lacks scope). */
  page: string;
}

export interface ForgeRepository {
  host: string;
  /** `owner/repo` (GitLab may use `group/sub/repo`). */
  path: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  webUrl: string;
  /** HTTPS clone URL without a token (the token travels through the app's credential helper). */
  cloneUrl: string;
}

/** Pull Request (GitHub / Bitbucket) or Merge Request (GitLab). */
export interface ForgeMergeRequest {
  host: string;
  /** PR number (GitHub) or iid (GitLab / Bitbucket). */
  number: string;
  title: string;
  body: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  draft: boolean;
  webUrl: string;
  /** A PR from another repo (fork) has `headHost` different from `host`. */
  headHost: string;
  headOwner: string;
  updatedAt: string;
  commits: number | null;
  /** Assignee (Bitbucket has no such concept, so this is always empty). */
  assignees: ForgePerson[];
  /** Requested reviewer. */
  reviewers: ForgePerson[];
}

/** Users on the server who can be assigned to a PR / MR (or already are). */
export interface ForgePerson {
  username: string;
  /** Display name; may be empty (GitHub only returns the login). */
  name: string;
  /** GitLab assigns users by numeric id; GitHub assigns by `username` (no id available). */
  id: number | null;
}

/** Code the user types on the server's sign-in page (OAuth device flow). */
export interface ForgeDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  /** RFC 8628 secret: the webview holds it to ask for the token; it expires together with the user code. */
  deviceCode: string;
}
