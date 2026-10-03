// Dòng thời gian snapshot của working tree (đặc tả chung: packages/contracts/snapshot.json). Mỗi worktree một ref
// `refs/worktree/thaigit/snapshots`; mỗi mốc là một mục reflog của nó (kiểu refs/stash) nên `git log --all` chỉ thấy tối đa
// một commit thừa. Commit snapshot = tree của TOÀN BỘ working tree (tôn trọng .gitignore) dựng qua index tạm trong git dir —
// không bao giờ đụng index thật, nhánh, stash hay HEAD của người dùng.

import {
  formatSnapshotMessage,
  parseSnapshotMessage,
  selectExpiredSnapshots,
  snapshotIdentityEnv,
  snapshotSpec,
  type EnvProfile,
  type SnapshotReason,
} from '@thaigit/contracts';
import { decodeUtf8, encodeUtf8, nulSeparated } from './bytes.ts';
import type { FileChange } from './models.ts';
import { parseNameStatus } from './parsers.ts';
import type { GitRepository } from './repository.ts';
import { GitError, GitRunner } from './runner.ts';

export interface SnapshotEntry {
  /** Vị trí trong reflog (0 = mới nhất) — dùng để xoá (`ref@{index}`). */
  readonly index: number;
  readonly sha: string;
  readonly tree: string;
  /** Thời điểm chụp (giây). */
  readonly time: number;
  readonly reason: SnapshotReason;
  /** Số file khác HEAD lúc chụp; null khi không rõ. */
  readonly files: number | null;
}

export interface SnapshotTakeOptions {
  /**
   * Chạy nền (mặc định với lý do `auto`): repo đang bận thì bỏ qua (lỗi `busy`), không ghi Nhật ký lệnh, không bao giờ hỏi
   * đăng nhập. `false` khi người dùng bấm (mốc trước khi khôi phục): xếp hàng như thao tác thường.
   */
  background?: boolean;
}

export interface SnapshotRestoreResult {
  /** Mốc chụp ngay trước khi khôi phục — khôi phục về nó là Hoàn tác. */
  readonly before: SnapshotEntry;
  /** File được ghi lại / xoá khỏi working tree theo mốc. */
  readonly restored: readonly string[];
  /** File chưa track tạo sau mốc, đã dời vào thùng rác của app. */
  readonly trashed: readonly string[];
}

export interface SnapshotPruneOptions {
  /** Giây. */
  now: number;
  keepDays: number;
  keepCount: number;
}

const REF = snapshotSpec.ref;
const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: '1' } as const;
/** `reflog delete` nhận nhiều mục một lần; chia lô để dòng lệnh không quá dài. */
const PRUNE_BATCH = 100;
/** Số đường dẫn mỗi lần `ls-files … -- <đường dẫn>` (giữ dòng lệnh dưới giới hạn ~32 KB của Windows). */
const PATH_BATCH = 100;
const LOG_FIELD = '\x1f';

function isStaleIndexLock(error: unknown): boolean {
  return error instanceof GitError && error.contains('.lock') && error.contains('exists');
}

/** Đường dẫn `path` nằm trong phạm vi `paths` (đúng file hoặc nằm trong thư mục); `null` = mọi đường dẫn. */
function inScope(path: string, paths: readonly string[] | null): boolean {
  return paths === null || paths.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

export class SnapshotStore {
  /** Runner không ghi Nhật ký lệnh: chụp tự động mỗi vài phút sẽ làm ngập nhật ký. */
  private readonly quiet: GitRunner;

  constructor(private readonly repo: GitRepository) {
    this.quiet = new GitRunner(repo.runner.exec);
  }

  /** Các mốc, mới nhất trước (bỏ qua mục reflog không phải snapshot của Thaigit, nhưng giữ đúng chỉ số reflog). */
  async list(limit?: number): Promise<SnapshotEntry[]> {
    return this.read(this.repo.runner, limit);
  }

  /**
   * Chụp working tree. Cây giống hệt mốc mới nhất → trả mốc đó, không tạo mốc mới. Lỗi `busy` (repo đang có thao tác ghi) khi
   * chạy nền: người gọi bỏ qua lần này.
   */
  async take(reason: SnapshotReason, options: SnapshotTakeOptions = {}): Promise<SnapshotEntry> {
    const background = options.background ?? reason === 'auto';
    const runner = background ? this.quiet : this.repo.runner;
    const profile: EnvProfile = background ? 'background' : 'interactive';

    let indexFile = await this.repo.fs.prepareSnapshotIndex(false);
    try {
      await runner.run('add', ['-A'], { env: { GIT_INDEX_FILE: indexFile }, profile });
    } catch (error) {
      if (!isStaleIndexLock(error)) throw error;
      // Khoá mồ côi khi app bị tắt giữa lúc `git add`: index tạm chỉ là bộ đệm, dựng lại từ đầu.
      indexFile = await this.repo.fs.prepareSnapshotIndex(true);
      await runner.run('add', ['-A'], { env: { GIT_INDEX_FILE: indexFile }, profile });
    }
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    const tree = (await runner.text('write-tree', [], { env: indexEnv, profile })).trim();

    const [latest] = await this.read(runner, 1);
    if (latest !== undefined && latest.index === 0 && latest.tree === tree) return latest;

    const headOut = await runner.run('rev-parse', ['--verify', '-q', 'HEAD'], { acceptExitCodes: [0, 1] });
    const head = headOut.code === 0 ? decodeUtf8(headOut.stdout).trim() : null;
    const changed = await runner.run('diff', ['--cached', '--name-only', '-z'], {
      env: { ...indexEnv, GIT_OPTIONAL_LOCKS: '0' },
      profile,
    });
    const files = decodeUtf8(changed.stdout)
      .split('\0')
      .filter((path) => path !== '').length;

    const sha = (
      await runner.text(
        'commit-tree',
        [tree, ...(head !== null ? ['-p', head] : []), '--no-gpg-sign', '-F', '-'],
        {
          stdin: encodeUtf8(formatSnapshotMessage(reason, files)),
          env: snapshotIdentityEnv(),
          profile,
        },
      )
    ).trim();
    await runner.run('update-ref', ['--create-reflog', '-m', snapshotSpec.reflogMessage, REF, sha], {
      profile,
    });
    const [entry] = await this.read(runner, 1);
    return entry ?? { index: 0, sha, tree, time: Math.floor(Date.now() / 1000), reason, files };
  }

  /** File khác nhau giữa hai mốc (`from` → `to`). */
  async changes(from: string, to: string): Promise<FileChange[]> {
    return this.repo.changedFiles(to, from);
  }

  /** Diff một file giữa hai mốc (byte thô, như diff của commit). */
  async diffBytes(from: string, to: string, file: FileChange): Promise<Uint8Array> {
    return this.repo.commitDiffBytes(to, from, file);
  }

  /**
   * Đưa working tree (toàn bộ, hoặc chỉ `paths` — file hay thư mục) về như mốc `target`. Luôn chụp mốc "trước khôi phục" trước;
   * chỉ ghi working tree (index, nhánh, stash giữ nguyên). File chưa track tạo sau mốc được dời vào thùng rác của app thay vì xoá.
   */
  async restore(target: string, paths: readonly string[] | null): Promise<SnapshotRestoreResult> {
    const before = await this.take('before-restore', { background: false });
    const runner = this.repo.runner;
    const diff = await runner.run('diff-tree', [
      '-r',
      '-z',
      '--name-status',
      '--no-renames',
      target,
      before.sha,
    ]);
    const changes = parseNameStatus(diff.stdout).filter((change) => inScope(change.path, paths));
    if (changes.length === 0) return { before, restored: [], trashed: [] };

    // Có ở hiện tại mà không có trong mốc: file đã track thì `restore --source` tự xoá; file chưa track thì dời vào thùng rác.
    const added = changes.filter((change) => change.kind === 'added').map((change) => change.path);
    const trackedPaths = new Set<string>();
    // `ls-files` không có `--pathspec-from-file`: đường dẫn đứng sau `--` (chia lô cho dòng lệnh Windows).
    for (let start = 0; start < added.length; start += PATH_BATCH) {
      const batch = added.slice(start, start + PATH_BATCH);
      const out = await runner.run('ls-files', ['-z', '--cached', '--', ...batch], {
        env: LITERAL_PATHSPECS,
      });
      for (const path of decodeUtf8(out.stdout).split('\0')) trackedPaths.add(path);
    }
    const untracked = added.filter((path) => !trackedPaths.has(path));
    const restored = changes.map((change) => change.path).filter((path) => !untracked.includes(path));
    if (untracked.length > 0) await this.repo.fs.trashUntracked(untracked);
    if (restored.length > 0) {
      await runner.run(
        'restore',
        [`--source=${target}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'],
        { stdin: nulSeparated(restored), env: LITERAL_PATHSPECS },
      );
    }
    return { before, restored, trashed: untracked };
  }

  /** Xoá mốc quá hạn / quá số lượng (luật chung `selectExpiredSnapshots`); trả số mốc đã xoá. */
  async prune(options: SnapshotPruneOptions): Promise<number> {
    const entries = await this.readTimes(this.quiet);
    const expired = selectExpiredSnapshots(entries, options.now, options.keepDays, options.keepCount);
    for (let start = 0; start < expired.length; start += PRUNE_BATCH) {
      const batch = expired.slice(start, start + PRUNE_BATCH).map((index) => `${REF}@{${index}}`);
      await this.quiet.run('reflog', ['delete', '--rewrite', ...batch], { profile: 'background' });
    }
    return expired.length;
  }

  private async exists(runner: GitRunner): Promise<boolean> {
    const out = await runner.run('rev-parse', ['--verify', '-q', REF], { acceptExitCodes: [0, 1] });
    return out.code === 0;
  }

  private async read(runner: GitRunner, limit?: number): Promise<SnapshotEntry[]> {
    if (!(await this.exists(runner))) return [];
    const args = ['-g', '-z', '--format=%H%x1f%T%x1f%ct%x1f%B'];
    if (limit !== undefined) args.push(`--max-count=${Math.max(1, Math.trunc(limit))}`);
    const out = await runner.text('log', [...args, REF, '--']);
    const entries: SnapshotEntry[] = [];
    out.split('\0').forEach((record, index) => {
      if (record === '') return;
      const [sha = '', tree = '', time = '', ...body] = record.split(LOG_FIELD);
      const meta = parseSnapshotMessage(body.join(LOG_FIELD));
      if (meta === null) return;
      entries.push({ index, sha, tree, time: Number(time), reason: meta.reason, files: meta.files });
    });
    return entries;
  }

  /** Mọi mục reflog (kể cả không phải snapshot) — luật dọn tính trên chỉ số reflog thật. */
  private async readTimes(runner: GitRunner): Promise<{ index: number; time: number }[]> {
    if (!(await this.exists(runner))) return [];
    const out = await runner.text('log', ['-g', '-z', '--format=%ct', REF, '--']);
    return out
      .split('\0')
      .filter((record) => record !== '')
      .map((record, index) => ({ index, time: Number(record.trim()) }));
  }
}
