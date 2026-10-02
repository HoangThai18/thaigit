// Repository Git và mọi thao tác Thaigit dùng (port GitRepository.swift). Mỗi hàm chạy một hoặc vài lệnh `git` qua
// `Exec`; mọi I/O file qua `RepoFs`. KHÔNG parse diff/patch ở đây (module `diff/`): hàm diff trả byte thô, dòng staging
// nhận patch dạng byte. `exec` (main thread) và parse (worker) tách nhau: ví dụ `logBytes()` trả byte, `parseLog()` thuần.
//
// Quy ước an toàn cho validator (git-policy.json): chuỗi tự do (message…) đi qua stdin (`-F -`) hoặc dạng `--opt=giá trị`;
// đường dẫn đi qua `--pathspec-from-file=- --pathspec-file-nul` hoặc đứng sau `--` cùng `GIT_LITERAL_PATHSPECS=1`;
// không dùng cờ ngắn gắn liền giá trị. Tên nhánh/rev/remote không được bắt đầu bằng `-` (chống bị hiểu thành cờ).

import type { EnvProfile } from '@thaigit/contracts';
import type { Exec, RepoFs, TypedGit } from '../ports/index.ts';
import type { CommandLog } from '../support/command-log.ts';
import { osBasename } from '../support/paths.ts';
import { decodeUtf8, encodeUtf8, nulSeparated } from './bytes.ts';
import {
  fileChange,
  fileChangeAllPaths,
  type Commit,
  type CommitDetails,
  type ConflictKind,
  type FileChange,
  type GitRef,
  type LogOrder,
  type MergeStyle,
  type PullMode,
  type Remote,
  type RepoOperation,
  type ResetMode,
  type Stash,
  type WorkingDiffKind,
  type WorkingTreeStatus,
} from './models.ts';
import {
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
} from './parsers.ts';
import { isValidRefName } from './refname.ts';
import { AdapterError, GitError, GitRunner } from './runner.ts';

export type RepositoryErrorKind = 'notARepository' | 'bareRepository' | 'invalidName';

/** Lỗi mở repository / tham số không hợp lệ (thông báo tiếng Việt như bản Swift). */
export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;
  /** Đường dẫn (notARepository/bareRepository) hoặc tên bị từ chối (invalidName). */
  readonly subject: string;

  constructor(kind: RepositoryErrorKind, subject: string) {
    super(repositoryErrorMessage(kind, subject));
    this.name = 'RepositoryError';
    this.kind = kind;
    this.subject = subject;
  }
}

function repositoryErrorMessage(kind: RepositoryErrorKind, subject: string): string {
  switch (kind) {
    case 'notARepository':
      return `“${subject}” không phải là một Git repository.`;
    case 'bareRepository':
      return `“${subject}” là bare repository (không có working tree) — Thaigit chưa hỗ trợ loại này.`;
    case 'invalidName':
      return `Tên “${subject}” không hợp lệ.`;
  }
}

export interface GitRepositoryOptions {
  exec: Exec;
  fs: RepoFs;
  /** Gốc working tree. Đã chuẩn hoá (realpath) bởi bộ mở repo. */
  root: string;
  gitDir: string;
  commonDir: string;
  /** Nhật ký lệnh (đã che credential khi ghi). */
  log?: CommandLog;
  /** Lệnh có kiểu (config set, remote add/set-url). Thiếu → các hàm đó báo lỗi rõ ràng. */
  typed?: TypedGit;
}

export interface LogOptions {
  limit: number;
  order: LogOrder;
  /** Thêm `HEAD` (cần khi HEAD detached hoặc nhánh hiện tại chưa trong `--branches`). */
  includeHead: boolean;
  includeRemotes?: boolean;
  includeTags?: boolean;
}

/** Tuỳ chọn chung của lệnh mạng. */
export interface NetworkOptions {
  onProgress?: (line: string) => void;
  /** Huỷ theo bậc (chỉ lệnh `network`). */
  signal?: AbortSignal;
  /** `background` cho tự fetch: không bao giờ bật hộp thoại đăng nhập. */
  profile?: EnvProfile;
}

export interface FetchOptions extends NetworkOptions {
  /** Mặc định (null/undefined) = `--all`. */
  remote?: string | null;
  prune?: boolean;
}

export interface PushOptions extends NetworkOptions {
  remote: string;
  localBranch: string;
  remoteBranch: string;
  setUpstream?: boolean;
  /** `--force-with-lease`. */
  force?: boolean;
}

export interface CommitOptions {
  amend?: boolean;
  allowEmpty?: boolean;
}

export interface ApplyPatchOptions {
  /** Áp vào index thay vì working tree. */
  cached: boolean;
  reverse: boolean;
  /**
   * Cho phép patch không có dòng ngữ cảnh (`-U0`): git từ chối chúng nếu thiếu `--unidiff-zero`. Chỉ bật khi patch
   * sinh ra với `-U0` (git không kiểm được vị trí bằng ngữ cảnh nên dựa hoàn toàn vào số dòng của hunk).
   */
  unidiffZero?: boolean;
}

const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: '1' } as const;
const NO_OPTIONAL_LOCKS = { GIT_OPTIONAL_LOCKS: '0' } as const;
const DIFF_ENV = { ...LITERAL_PATHSPECS, ...NO_OPTIONAL_LOCKS } as const;

/** Subcommand điều khiển từng thao tác dở dang (`<sub> --abort|--continue|--skip`); bisect có luật riêng. */
const OPERATION_SUBCOMMAND = {
  merging: 'merge',
  rebasing: 'rebase',
  cherryPicking: 'cherry-pick',
  reverting: 'revert',
  applyingPatches: 'am',
} as const;

/** Tên ref/remote/rev đưa vào argv: không rỗng, không bắt đầu bằng `-` (khỏi bị hiểu là cờ), không NUL/xuống dòng. */
function assertArgument(value: string): void {
  if (value === '' || value.startsWith('-') || /[\0\r\n]/.test(value))
    throw new RepositoryError('invalidName', value);
}

/** Phần tử ghép vào refspec: phải là tên nhánh/tag hợp lệ (ký tự `:` hay `+` sẽ đổi nghĩa refspec). */
function assertRefspecName(value: string, branch: boolean): void {
  if (!isValidRefName(value, branch)) throw new RepositoryError('invalidName', value);
}

function assertContext(context: number): void {
  if (!Number.isInteger(context) || context < 0 || context > 1_000_000)
    throw new RangeError(`Số dòng ngữ cảnh không hợp lệ: ${context}`);
}

function assertNoNul(value: string): void {
  if (value.includes('\0')) throw new RepositoryError('invalidName', value.replaceAll('\0', '\\0'));
}

function parseOptionalInt(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export class GitRepository {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly runner: GitRunner;
  readonly fs: RepoFs;
  private readonly typed: TypedGit | undefined;

  constructor(options: GitRepositoryOptions) {
    this.root = options.root;
    this.gitDir = options.gitDir;
    this.commonDir = options.commonDir;
    this.fs = options.fs;
    this.runner = new GitRunner(options.exec, options.log);
    this.typed = options.typed;
  }

  get name(): string {
    return osBasename(this.root);
  }

  // MARK: - Đọc dữ liệu

  async refs(): Promise<GitRef[]> {
    const out = await this.runner.run('for-each-ref', [
      `--format=${REF_FORMAT}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    return parseRefs(out.stdout);
  }

  async status(): Promise<WorkingTreeStatus> {
    const out = await this.runner.run(
      'status',
      ['--porcelain=v2', '--branch', '--show-stash', '-z', '--untracked-files=all'],
      {
        env: NO_OPTIONAL_LOCKS,
      },
    );
    return parseStatus(out.stdout);
  }

  async stashes(): Promise<Stash[]> {
    const out = await this.runner.run('stash', ['list', '-z', `--format=${STASH_FORMAT}`]);
    return parseStashList(out.stdout);
  }

  async remotes(): Promise<Remote[]> {
    return parseRemotes(await this.runner.text('remote', ['-v']));
  }

  /**
   * Output thô của `git log -z` (để parse + xếp làn trong worker bằng `buildHistory`). Repo chưa có commit → byte rỗng.
   * Lịch sử gồm mọi nhánh local, (tuỳ chọn) remote/tag và HEAD.
   */
  async logBytes(options: LogOptions): Promise<Uint8Array> {
    const args = [
      '-z',
      `--format=${LOG_FORMAT}`,
      options.order === 'topo' ? '--topo-order' : '--date-order',
      `--max-count=${Math.max(1, Math.trunc(options.limit))}`,
      '--branches',
    ];
    if (options.includeRemotes ?? true) args.push('--remotes');
    if (options.includeTags ?? true) args.push('--tags');
    if (options.includeHead) args.push('HEAD');
    args.push('--');
    try {
      return (await this.runner.run('log', args)).stdout;
    } catch (error) {
      if (
        error instanceof GitError &&
        (error.contains('does not have any commits') ||
          error.contains('bad default revision') ||
          error.contains('unknown revision') ||
          // `HEAD` là revision tường minh duy nhất trong lệnh: repo chưa có commit thì git báo "bad revision 'HEAD'".
          error.contains('bad revision'))
      ) {
        return new Uint8Array(0);
      }
      throw error;
    }
  }

  /** `logBytes` + `parseLog` trên cùng luồng (tiện cho test/repo nhỏ; app dùng worker). */
  async log(options: LogOptions): Promise<Commit[]> {
    return parseLog(await this.logBytes(options));
  }

  async commitMessage(sha: string): Promise<string> {
    assertArgument(sha);
    return this.runner.text('show', ['-s', '--format=%B', sha, '--']);
  }

  /** File thay đổi trong commit (so với cha đầu tiên; commit gốc so với cây rỗng). */
  async changedFiles(sha: string, parent: string | null): Promise<FileChange[]> {
    assertArgument(sha);
    if (parent !== null) assertArgument(parent);
    const args = [
      '-r',
      '-z',
      '--name-status',
      '-M',
      '--no-commit-id',
      ...(parent !== null ? [parent, sha] : ['--root', sha]),
    ];
    return parseNameStatus((await this.runner.run('diff-tree', args)).stdout);
  }

  /** Message + file thay đổi của một commit. */
  async commitDetails(commit: Commit): Promise<CommitDetails> {
    const [message, files] = await Promise.all([
      this.commitMessage(commit.id),
      this.changedFiles(commit.id, commit.parents[0] ?? null),
    ]);
    return { commit, message, files };
  }

  /** Diff một file của commit (unified, BYTE thô — đưa cho `diff/` để parse). */
  async commitDiffBytes(
    sha: string,
    parent: string | null,
    file: FileChange,
    context = 3,
  ): Promise<Uint8Array> {
    assertArgument(sha);
    if (parent !== null) assertArgument(parent);
    assertContext(context);
    const args = [
      '-p',
      '-M',
      '--no-color',
      `-U${context}`,
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--no-commit-id',
      ...(parent !== null ? [parent, sha] : ['--root', sha]),
      '--',
      ...fileChangeAllPaths(file),
    ];
    return (await this.runner.run('diff-tree', args, { env: LITERAL_PATHSPECS })).stdout;
  }

  /** Diff một file trong working tree/index (byte thô). `untracked` so với /dev/null (git trả mã 1 khi có khác biệt). */
  async workingDiffBytes(change: FileChange, kind: WorkingDiffKind, context = 3): Promise<Uint8Array> {
    assertContext(context);
    const common = ['--no-color', `-U${context}`, '--src-prefix=a/', '--dst-prefix=b/'];
    switch (kind) {
      case 'unstaged':
        return (await this.runner.run('diff', [...common, '--', change.path], { env: DIFF_ENV })).stdout;
      case 'staged':
        return (
          await this.runner.run('diff', ['--cached', '-M', ...common, '--', ...fileChangeAllPaths(change)], {
            env: DIFF_ENV,
          })
        ).stdout;
      case 'untracked':
        return (
          await this.runner.run('diff', ['--no-index', ...common, '--', '/dev/null', change.path], {
            acceptExitCodes: [0, 1],
          })
        ).stdout;
    }
  }

  /** Nội dung blob, ví dụ "HEAD:path", ":path" (index), "<sha>:path". */
  async blob(spec: string): Promise<Uint8Array> {
    assertArgument(spec);
    return (await this.runner.run('cat-file', ['blob', spec])).stdout;
  }

  /** Byte của file trong working tree (null nếu không có). Đi qua `RepoFs` nên bị giới hạn trong repo. */
  async workingFileBytes(path: string, maxBytes?: number): Promise<Uint8Array | null> {
    return this.fs.readWorktreeFile(path, maxBytes);
  }

  async fileHistory(path: string, limit = 300): Promise<Commit[]> {
    assertNoNul(path);
    const out = await this.runner.run(
      'log',
      [
        '-z',
        `--format=${LOG_FORMAT}`,
        '--follow',
        `--max-count=${Math.max(1, Math.trunc(limit))}`,
        '--',
        path,
      ],
      { env: LITERAL_PATHSPECS },
    );
    return parseLog(out.stdout);
  }

  async resolveCommit(rev: string): Promise<string> {
    assertArgument(rev);
    return (await this.runner.text('rev-parse', ['--verify', '--quiet', `${rev}^{commit}`])).trim();
  }

  /** Giá trị cấu hình (null nếu chưa đặt). Mã thoát 1 của `git config --get` = chưa đặt; lỗi khác vẫn ném. */
  async config(key: string): Promise<string | null> {
    assertArgument(key);
    const out = await this.runner.run('config', ['--get', key], { acceptExitCodes: [0, 1] });
    if (out.code !== 0) return null;
    const value = decodeUtf8(out.stdout).trim();
    return value === '' ? null : value;
  }

  /** Đặt cấu hình (chỉ khoá trong allowlist của chính sách; kiểm ở bộ chuyển có kiểu). */
  async setConfig(key: string, value: string, scope: 'local' | 'global'): Promise<void> {
    await this.requireTyped().configSet(key, value, scope);
  }

  /** Hỏi git xem tên nhánh/tag có hợp lệ không (nguồn sự thật). Tên bắt đầu bằng `-` luôn bị từ chối. */
  async isValidRefName(name: string, branch: boolean): Promise<boolean> {
    if (name === '' || name.startsWith('-') || /[\0\r\n]/.test(name)) return false;
    try {
      await this.runner.run('check-ref-format', branch ? ['--branch', name] : [`refs/tags/${name}`]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }

  // MARK: - Trạng thái thao tác dở dang

  /** merge/rebase/cherry-pick/revert/am/bisect đang dở, đọc từ file trong git dir qua `RepoFs.readGitFile`. */
  async operationState(): Promise<RepoOperation | null> {
    const read = (name: string) => this.fs.readGitFile(name);
    const [rebaseMerge, amApplying, rebaseApply, mergeHead, cherryPickHead, revertHead, bisectLog] =
      await Promise.all([
        read('rebase-merge/head-name'),
        read('rebase-apply/applying'),
        read('rebase-apply/head-name'),
        read('MERGE_HEAD'),
        read('CHERRY_PICK_HEAD'),
        read('REVERT_HEAD'),
        read('BISECT_LOG'),
      ]);
    const headNameOf = (bytes: Uint8Array): string => {
      const value = decodeUtf8(bytes).trim();
      return value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
    };
    const readInt = async (name: string) => {
      const bytes = await read(name);
      return bytes === null ? null : parseOptionalInt(decodeUtf8(bytes));
    };
    if (rebaseMerge !== null) {
      const [step, total] = await Promise.all([readInt('rebase-merge/msgnum'), readInt('rebase-merge/end')]);
      return { kind: 'rebasing', step, total, headName: headNameOf(rebaseMerge) };
    }
    if (amApplying !== null) return { kind: 'applyingPatches' };
    if (rebaseApply !== null) {
      const [step, total] = await Promise.all([readInt('rebase-apply/next'), readInt('rebase-apply/last')]);
      return { kind: 'rebasing', step, total, headName: headNameOf(rebaseApply) };
    }
    if (mergeHead !== null) return { kind: 'merging' };
    if (cherryPickHead !== null) return { kind: 'cherryPicking' };
    if (revertHead !== null) return { kind: 'reverting' };
    if (bisectLog !== null) return { kind: 'bisecting' };
    return null;
  }

  /** Message gợi ý khi đang merge (MERGE_MSG/SQUASH_MSG), đã bỏ các dòng chú thích `#`. */
  async pendingCommitMessage(): Promise<string | null> {
    for (const name of ['MERGE_MSG', 'SQUASH_MSG']) {
      const bytes = await this.fs.readGitFile(name);
      if (bytes === null) continue;
      const message = decodeUtf8(bytes)
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim();
      if (message !== '') return message;
    }
    return null;
  }

  // MARK: - Stage / unstage / discard

  async stage(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.runner.run('add', ['-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      stdin: nulSeparated(paths),
      env: LITERAL_PATHSPECS,
    });
  }

  async stageAll(): Promise<void> {
    await this.runner.run('add', ['-A']);
  }

  async unstage(paths: readonly string[], headExists: boolean): Promise<void> {
    if (paths.length === 0) return;
    const stdin = nulSeparated(paths);
    if (headExists) {
      await this.runner.run('reset', ['-q', '--pathspec-from-file=-', '--pathspec-file-nul', 'HEAD'], {
        stdin,
        env: LITERAL_PATHSPECS,
      });
    } else {
      await this.runner.run('rm', ['--cached', '-r', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        stdin,
        env: LITERAL_PATHSPECS,
      });
    }
  }

  async unstageAll(headExists: boolean): Promise<void> {
    // Reset có pathspec để không xoá trạng thái merge đang dở.
    if (headExists) await this.runner.run('reset', ['-q', 'HEAD', '--', '.']);
    else await this.runner.run('rm', ['--cached', '-r', '-q', '--', '.']);
  }

  /** Bỏ thay đổi chưa stage của file đã track (khôi phục từ index). */
  async discard(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.runner.run('restore', ['--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      stdin: nulSeparated(paths),
      env: LITERAL_PATHSPECS,
    });
  }

  /** Dời file chưa track vào thùng rác của app (`<commonDir>/thaigit/trash/…`). Trả token để `restoreTrash`. */
  async trashUntracked(paths: readonly string[]): Promise<string> {
    return this.fs.trashUntracked(paths);
  }

  async restoreTrash(token: string): Promise<void> {
    await this.fs.restoreTrash(token);
  }

  /**
   * Ảnh chụp toàn bộ thay đổi đã track (index + worktree) thành một commit stash lơ lửng, không đụng tới working tree —
   * dùng để "Hoàn tác" sau khi huỷ thay đổi. Không có thay đổi → null.
   */
  async snapshotChanges(): Promise<string | null> {
    const sha = (await this.runner.text('stash', ['create'])).trim();
    return sha === '' ? null : sha;
  }

  /** Khôi phục nội dung working tree của các file từ một commit (không đổi index). */
  async restoreWorkingFiles(rev: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    assertArgument(rev);
    await this.runner.run(
      'restore',
      [`--source=${rev}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'],
      {
        stdin: nulSeparated(paths),
        env: LITERAL_PATHSPECS,
      },
    );
  }

  /** Lưu byte vào kho object (`hash-object -w --stdin`), trả SHA — ví dụ chụp lại nội dung file trước khi huỷ. */
  async hashObject(content: Uint8Array): Promise<string> {
    return (await this.runner.text('hash-object', ['-w', '--stdin'], { stdin: content })).trim();
  }

  /** Áp patch (byte, từ `diff/patch-builder`) vào index (`cached`) hoặc working tree; `reverse` để unstage/huỷ; `unidiffZero` cho patch `-U0`. */
  async applyPatch(patch: Uint8Array, options: ApplyPatchOptions): Promise<void> {
    const args = ['--whitespace=nowarn', '--recount'];
    if (options.unidiffZero) args.push('--unidiff-zero');
    if (options.cached) args.push('--cached');
    if (options.reverse) args.push('--reverse');
    args.push('-');
    await this.runner.run('apply', args, { stdin: patch });
  }

  async hardReset(rev = 'HEAD'): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['--hard', '-q', rev]);
  }

  async addToGitignore(pattern: string): Promise<void> {
    await this.fs.appendGitignore(pattern);
  }

  // MARK: - Commit

  async commit(message: string, options: CommitOptions = {}): Promise<void> {
    const args = ['--cleanup=whitespace', '-F', '-'];
    if (options.amend) args.push('--amend');
    if (options.allowEmpty) args.push('--allow-empty');
    await this.runner.run('commit', args, { stdin: encodeUtf8(message) });
  }

  /** Đưa nhánh hiện tại về `rev` giữ nguyên thay đổi (dùng để hoàn tác commit). */
  async softReset(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['--soft', rev]);
  }

  /** Xoá commit đầu tiên của nhánh (nhánh trở lại trạng thái chưa có commit), giữ index. */
  async undoInitialCommit(): Promise<void> {
    await this.runner.run('update-ref', ['-d', 'HEAD']);
  }

  // MARK: - Nhánh

  async switchTo(branch: string): Promise<void> {
    assertArgument(branch);
    await this.runner.run('switch', ['--no-guess', branch]);
  }

  async switchDetached(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('switch', ['--detach', rev]);
  }

  async createBranch(name: string, startPoint: string | null, checkout: boolean): Promise<void> {
    assertArgument(name);
    if (startPoint !== null) assertArgument(startPoint);
    const start = startPoint === null ? [] : [startPoint];
    if (checkout) await this.runner.run('switch', ['-c', name, ...start]);
    else await this.runner.run('branch', [name, ...start]);
  }

  /** Tạo nhánh local theo dõi nhánh remote rồi checkout. */
  async checkoutTracking(remoteBranch: string, localName: string): Promise<void> {
    assertArgument(remoteBranch);
    assertArgument(localName);
    await this.runner.run('switch', ['-c', localName, '--track', remoteBranch]);
  }

  async deleteBranch(name: string, force: boolean): Promise<void> {
    assertArgument(name);
    await this.runner.run('branch', [force ? '-D' : '-d', name]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    assertArgument(oldName);
    assertArgument(newName);
    await this.runner.run('branch', ['-m', oldName, newName]);
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    assertArgument(branch);
    assertArgument(upstream);
    await this.runner.run('branch', [`--set-upstream-to=${upstream}`, branch]);
  }

  async unsetUpstream(branch: string): Promise<void> {
    assertArgument(branch);
    await this.runner.run('branch', ['--unset-upstream', branch]);
  }

  /** Đặt ref về một object cụ thể (dùng để khôi phục nhánh/tag đã xoá). */
  async updateRef(fullName: string, object: string): Promise<void> {
    assertArgument(fullName);
    assertArgument(object);
    await this.runner.run('update-ref', [fullName, object]);
  }

  /** Fast-forward nhánh không phải nhánh hiện tại tới upstream của nó. */
  async fastForward(branch: string, upstream: string): Promise<void> {
    assertRefspecName(branch, true);
    assertArgument(upstream);
    if (upstream.includes(':')) throw new RepositoryError('invalidName', upstream);
    await this.runner.run('fetch', ['.', `${upstream}:refs/heads/${branch}`]);
  }

  // MARK: - Merge / rebase / cherry-pick / revert / reset

  async merge(ref: string, style: MergeStyle = 'automatic'): Promise<void> {
    assertArgument(ref);
    const args = ['--no-edit'];
    if (style === 'noFastForward') args.push('--no-ff');
    else if (style === 'fastForwardOnly') args.push('--ff-only');
    else if (style === 'squash') args.push('--squash');
    args.push(ref);
    await this.runner.run('merge', args);
  }

  /** Rebase nhánh `branch` (mặc định nhánh hiện tại) lên `ref`. Có `branch` thì git tự checkout nhánh đó trước. */
  async rebase(onto: string, branch: string | null = null): Promise<void> {
    assertArgument(onto);
    if (branch !== null) assertArgument(branch);
    await this.runner.run('rebase', branch === null ? [onto] : [onto, branch]);
  }

  async cherryPick(sha: string, mainline: number | null = null): Promise<void> {
    assertArgument(sha);
    await this.runner.run('cherry-pick', [...this.mainlineArgs(mainline), sha]);
  }

  async revert(sha: string, mainline: number | null = null): Promise<void> {
    assertArgument(sha);
    await this.runner.run('revert', ['--no-edit', ...this.mainlineArgs(mainline), sha]);
  }

  private mainlineArgs(mainline: number | null): string[] {
    if (mainline === null) return [];
    if (!Number.isInteger(mainline) || mainline < 1)
      throw new RangeError(`Số cha (mainline) không hợp lệ: ${mainline}`);
    return ['-m', String(mainline)];
  }

  async reset(rev: string, mode: ResetMode): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['-q', `--${mode}`, rev]);
  }

  /** Hoàn tác merge/rebase vừa xong mà vẫn giữ thay đổi local chưa commit. */
  async resetKeepingLocalChanges(rev: string): Promise<void> {
    assertArgument(rev);
    await this.runner.run('reset', ['-q', '--merge', rev]);
  }

  async abort(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'bisecting') await this.runner.run('bisect', ['reset']);
    else await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--abort']);
  }

  async continueOperation(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'bisecting') return;
    await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--continue']);
  }

  async skip(operation: RepoOperation): Promise<void> {
    if (operation.kind === 'merging' || operation.kind === 'bisecting') return;
    await this.runner.run(OPERATION_SUBCOMMAND[operation.kind], ['--skip']);
  }

  // MARK: - Xung đột

  /** Giải quyết xung đột bằng toàn bộ phiên bản của một bên. */
  async resolveConflict(path: string, kind: ConflictKind, useOurs: boolean): Promise<void> {
    assertNoNul(path);
    const sideMissing = useOurs
      ? kind === 'deletedByUs' || kind === 'bothDeleted' || kind === 'addedByThem'
      : kind === 'deletedByThem' || kind === 'bothDeleted' || kind === 'addedByUs';
    if (sideMissing) {
      await this.runner.run('rm', ['-q', '--', path], { env: LITERAL_PATHSPECS });
    } else {
      await this.runner.run('checkout', [useOurs ? '--ours' : '--theirs', '--', path], {
        env: LITERAL_PATHSPECS,
      });
      await this.runner.run('add', ['--', path], { env: LITERAL_PATHSPECS });
    }
  }

  async markResolved(paths: readonly string[]): Promise<void> {
    await this.stage(paths);
  }

  /** Byte của file đang xung đột trong working tree (null nếu không có). */
  async readWorkingFile(path: string, maxBytes?: number): Promise<Uint8Array | null> {
    return this.fs.readWorktreeFile(path, maxBytes);
  }

  /** Ghi file working tree (so sánh-và-ghi bằng SHA-256 của nội dung đã đọc; `null` = file phải chưa tồn tại). */
  async writeWorkingFile(path: string, bytes: Uint8Array, expectedSha256: string | null): Promise<void> {
    await this.fs.writeWorktreeFile(path, bytes, expectedSha256);
  }

  // MARK: - Remote

  async fetch(options: FetchOptions = {}): Promise<void> {
    const args = ['--progress'];
    if (options.prune) args.push('--prune');
    if (options.remote !== undefined && options.remote !== null) {
      assertArgument(options.remote);
      args.push(options.remote);
    } else {
      args.push('--all');
    }
    await this.runner.run('fetch', args, networkRunOptions(options));
  }

  /**
   * Pull = `fetch` (mạng, huỷ được) rồi tích hợp bằng `merge`/`rebase` (ghi, KHÔNG huỷ — giết git giữa lúc ghi để lại
   * `index.lock` mồ côi hay rebase dở). Nhánh hiện tại phải có upstream.
   */
  async pull(mode: PullMode, options: NetworkOptions = {}): Promise<void> {
    // Chưa có upstream thì ném luôn lỗi của git ("no upstream configured for branch …") thay vì fetch vô ích.
    const upstream = (await this.runner.text('rev-parse', ['--symbolic-full-name', '@{upstream}'])).trim();
    await this.runner.run('fetch', ['--progress'], networkRunOptions(options));
    switch (mode) {
      case 'merge':
        await this.runner.run('merge', ['--no-edit', upstream]);
        break;
      case 'fastForwardOnly':
        await this.runner.run('merge', ['--ff-only', upstream]);
        break;
      case 'rebase':
        // `--fork-point` như `git pull --rebase`: bỏ qua commit local mà upstream đã viết lại.
        await this.runner.run('rebase', ['--fork-point', upstream]);
        break;
    }
  }

  async push(options: PushOptions): Promise<void> {
    assertArgument(options.remote);
    assertRefspecName(options.localBranch, true);
    assertRefspecName(options.remoteBranch, true);
    const args = ['--progress'];
    if (options.setUpstream) args.push('--set-upstream');
    if (options.force) args.push('--force-with-lease');
    args.push(options.remote, `refs/heads/${options.localBranch}:refs/heads/${options.remoteBranch}`);
    await this.runner.run('push', args, networkRunOptions(options));
  }

  /** Đẩy một commit bất kỳ lên nhánh trên remote (dùng để khôi phục nhánh remote vừa xoá). */
  async pushCommit(sha: string, remote: string, branch: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    if (!/^[0-9a-fA-F]{4,64}$/.test(sha)) throw new RepositoryError('invalidName', sha);
    assertRefspecName(branch, true);
    await this.runner.run(
      'push',
      ['--progress', remote, `${sha}:refs/heads/${branch}`],
      networkRunOptions(options),
    );
  }

  async deleteRemoteBranch(remote: string, branch: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(branch, true);
    await this.runner.run(
      'push',
      ['--progress', remote, '--delete', `refs/heads/${branch}`],
      networkRunOptions(options),
    );
  }

  async pushTag(remote: string, tag: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(tag, false);
    await this.runner.run('push', ['--progress', remote, `refs/tags/${tag}`], networkRunOptions(options));
  }

  async pushAllTags(remote: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    await this.runner.run('push', ['--progress', remote, '--tags'], networkRunOptions(options));
  }

  async deleteRemoteTag(remote: string, tag: string, options: NetworkOptions = {}): Promise<void> {
    assertArgument(remote);
    assertRefspecName(tag, false);
    await this.runner.run('push', [remote, '--delete', `refs/tags/${tag}`], networkRunOptions(options));
  }

  /** Thêm remote (lệnh có kiểu: URL do bộ chuyển kiểm). */
  async addRemote(name: string, url: string): Promise<void> {
    assertArgument(name);
    await this.requireTyped().remoteAdd(name, url);
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    assertArgument(name);
    await this.requireTyped().remoteSetUrl(name, url);
  }

  async removeRemote(name: string): Promise<void> {
    assertArgument(name);
    await this.runner.run('remote', ['remove', name]);
  }

  // MARK: - Stash

  async stashPush(message: string | null, includeUntracked: boolean): Promise<void> {
    const args = ['push'];
    if (includeUntracked) args.push('--include-untracked');
    if (message !== null && message !== '') {
      assertNoNul(message);
      args.push(`--message=${message}`);
    }
    await this.runner.run('stash', args);
  }

  async stashApply(selector: string, restoreIndex = false): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['apply', ...(restoreIndex ? ['--index'] : []), selector]);
  }

  async stashPop(selector: string): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['pop', selector]);
  }

  async stashDrop(selector: string): Promise<void> {
    assertArgument(selector);
    await this.runner.run('stash', ['drop', selector]);
  }

  /** Đưa lại một commit stash vào danh sách stash (hoàn tác "xoá stash"). */
  async stashStore(sha: string, message: string): Promise<void> {
    assertArgument(sha);
    assertNoNul(message);
    await this.runner.run('stash', ['store', `--message=${message}`, sha]);
  }

  /** File trong stash: thay đổi đã track (so với HEAD lúc stash) + file chưa track (cha thứ 3). */
  async stashFiles(stash: Stash): Promise<FileChange[]> {
    const files = await this.changedFiles(stash.sha, stash.parents[0] ?? null);
    const untrackedParent = stash.parents[2];
    if (untrackedParent === undefined) return files;
    const untracked = await this.changedFiles(untrackedParent, null);
    return [...files, ...untracked.map((file) => fileChange(file.path, 'untracked'))];
  }

  /** Diff một file của stash (byte thô). File chưa track nằm ở cha thứ 3 của commit stash. */
  async stashDiffBytes(stash: Stash, file: FileChange, context = 3): Promise<Uint8Array> {
    const untrackedParent = stash.parents[2];
    if (file.kind === 'untracked' && untrackedParent !== undefined)
      return this.commitDiffBytes(untrackedParent, null, file, context);
    return this.commitDiffBytes(stash.sha, stash.parents[0] ?? null, file, context);
  }

  // MARK: - Tag

  async createTag(name: string, rev: string, message: string | null): Promise<void> {
    assertArgument(name);
    assertArgument(rev);
    if (message !== null && message.trim() !== '') {
      assertNoNul(message);
      await this.runner.run('tag', ['-a', name, `--message=${message}`, rev]);
    } else {
      await this.runner.run('tag', [name, rev]);
    }
  }

  async deleteTag(name: string): Promise<void> {
    assertArgument(name);
    await this.runner.run('tag', ['-d', name]);
  }

  // MARK: - Nội bộ

  private requireTyped(): TypedGit {
    if (!this.typed)
      throw new AdapterError(
        'internal',
        'Chưa cấu hình bộ chuyển cho lệnh có kiểu (config set, remote add/set-url).',
      );
    return this.typed;
  }
}

function networkRunOptions(options: NetworkOptions): {
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
  profile?: EnvProfile;
} {
  return { onProgress: options.onProgress, signal: options.signal, profile: options.profile };
}
