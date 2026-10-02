// Bộ chuyển `RepoFs` cho Node: đọc/ghi file của repo THEO BYTE trong phạm vi repo, cùng luật với Rust (`repo_fs.rs`):
// đường dẫn chỉ tương đối; realpath phải nằm trong gốc working tree (hoặc git dir); từ chối `..`, tuyệt đối, symlink trỏ
// ra ngoài. Thêm một luật cứng hơn Rust: file working tree không bao giờ nằm trong `.git` (ghi `.git/hooks/*` = chạy lệnh).

import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { decodeUtf8, encodeUtf8 } from '../git/bytes.ts';
import { AdapterError } from '../git/runner.ts';
import type { RepoFs } from '../ports/index.ts';
import { checkRelativePath, hasGitComponent, relativeTo } from '../support/paths.ts';

export interface NodeRepoFsOptions {
  /** Gốc working tree. */
  root: string;
  gitDir: string;
  commonDir: string;
  /** So sánh đường dẫn không phân biệt hoa thường (mặc định: chỉ Windows). */
  caseInsensitive?: boolean;
  /** Thùng rác giữ bao lâu trước khi dọn (mặc định 7 ngày). */
  trashRetentionMs?: number;
}

/** File trong git dir mà `readGitFile` được phép đọc (ngoài `rebase-merge/*`, `rebase-apply/*`). */
const GIT_FILES = new Set([
  'MERGE_HEAD',
  'MERGE_MSG',
  'SQUASH_MSG',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
]);
const GIT_DIR_PREFIXES = ['rebase-merge/', 'rebase-apply/'];

/** Giới hạn đọc mặc định khi gọi `readWorktreeFile` không nêu `maxBytes`. */
export const DEFAULT_MAX_READ_BYTES = 64 * 1024 * 1024;

const DEFAULT_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOWS = process.platform === 'win32';
const TRASH_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface Roots {
  root: string;
  gitDir: string;
  commonDir: string;
}

interface Resolved {
  /** Đường dẫn thật (đã giải symlink; file chưa có thì là thư mục cha thật + tên). */
  path: string;
  exists: boolean;
}

interface TrashManifest {
  version: 1;
  createdAt: string;
  /** Đường dẫn tương đối (dùng `/`) của từng mục cấp cao đã dời. */
  items: string[];
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Bản sao thành `Uint8Array` thuần (Buffer của Node có thể nằm trong vùng nhớ dùng chung). */
function toBytes(buffer: Uint8Array): Uint8Array {
  return new Uint8Array(buffer);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function ioError(action: string, error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  return new AdapterError('io', `${action}: ${error instanceof Error ? error.message : String(error)}`);
}

export class NodeRepoFs implements RepoFs {
  private readonly caseInsensitive: boolean;
  private readonly retentionMs: number;
  private rootsPromise: Promise<Roots> | undefined;

  constructor(private readonly options: NodeRepoFsOptions) {
    this.caseInsensitive = options.caseInsensitive ?? WINDOWS;
    this.retentionMs = options.trashRetentionMs ?? DEFAULT_TRASH_RETENTION_MS;
  }

  // MARK: - Đọc

  async readGitFile(relative: string): Promise<Uint8Array | null> {
    if (!GIT_FILES.has(relative) && !GIT_DIR_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
      throw new AdapterError('out-of-scope', `Không được đọc "${relative}" trong git dir.`);
    }
    const resolved = await this.resolve('gitDir', relative);
    if (!resolved.exists) return null;
    try {
      return toBytes(await fsp.readFile(resolved.path));
    } catch (error) {
      if (isMissing(error)) return null;
      throw ioError(`Không đọc được ${relative}`, error);
    }
  }

  async readWorktreeFile(
    relative: string,
    maxBytes: number = DEFAULT_MAX_READ_BYTES,
  ): Promise<Uint8Array | null> {
    const resolved = await this.resolve('root', relative);
    if (!resolved.exists) return null;
    let handle: fsp.FileHandle;
    try {
      handle = await fsp.open(resolved.path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw ioError(`Không đọc được ${relative}`, error);
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new AdapterError('io', `"${relative}" không phải file thường.`);
      if (stat.size > maxBytes)
        throw new AdapterError('io', `"${relative}" lớn hơn giới hạn đọc (${maxBytes} byte).`);
      const bytes = toBytes(await handle.readFile());
      // File có thể lớn lên giữa lúc `stat` và lúc đọc.
      if (bytes.length > maxBytes)
        throw new AdapterError('io', `"${relative}" lớn hơn giới hạn đọc (${maxBytes} byte).`);
      return bytes;
    } catch (error) {
      throw ioError(`Không đọc được ${relative}`, error);
    } finally {
      await handle.close();
    }
  }

  // MARK: - Ghi

  async writeWorktreeFile(relative: string, bytes: Uint8Array, expectedSha256: string | null): Promise<void> {
    const resolved = await this.resolve('root', relative);
    const target = resolved.path;
    let mode: number | undefined;
    if (resolved.exists) {
      const stat = await fsp.stat(target).catch((error: unknown) => {
        throw ioError(`Không đọc được ${relative}`, error);
      });
      if (!stat.isFile()) throw new AdapterError('io', `"${relative}" không phải file thường.`);
      mode = stat.mode & 0o7777;
    }

    // Ghi tạm cùng thư mục (cùng ổ → rename nguyên tử), kiểm CAS ngay trước khi rename để cửa sổ xung đột nhỏ nhất.
    const temp = join(dirname(target), `.${basename(target)}.thaigit-${randomBytes(4).toString('hex')}.tmp`);
    let created = false;
    try {
      const handle = await fsp.open(temp, 'wx', mode === undefined ? 0o666 : mode & 0o777);
      created = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        if (mode !== undefined && !WINDOWS) await handle.chmod(mode);
      } finally {
        await handle.close();
      }
      await this.assertUnchanged(relative, target, expectedSha256);
      await fsp.rename(temp, target);
    } catch (error) {
      if (created) await fsp.rm(temp, { force: true }).catch(() => undefined);
      if (!created && isMissing(error))
        throw new AdapterError('not-found', `Thư mục chứa "${relative}" không tồn tại.`);
      throw ioError(`Không ghi được ${relative}`, error);
    }
  }

  /** CAS: nội dung hiện tại phải đúng là bản mà người gọi đã đọc (`expectedSha256`), hoặc file phải chưa tồn tại (`null`). */
  private async assertUnchanged(
    relative: string,
    target: string,
    expectedSha256: string | null,
  ): Promise<void> {
    let current: Uint8Array | null;
    try {
      current = toBytes(await fsp.readFile(target));
    } catch (error) {
      if (!isMissing(error)) throw error;
      current = null;
    }
    const actual = current === null ? null : sha256Hex(current);
    if (actual !== (expectedSha256 === null ? null : expectedSha256.toLowerCase())) {
      throw new AdapterError(
        'conflict',
        `"${relative}" đã bị thay đổi bên ngoài ứng dụng; hãy tải lại trước khi ghi.`,
      );
    }
  }

  async appendGitignore(line: string): Promise<void> {
    if (line.trim() === '' || /[\0\r\n]/.test(line))
      throw new AdapterError('policy', 'Dòng .gitignore không hợp lệ.');
    const resolved = await this.resolve('root', '.gitignore');
    try {
      let eol = '\n';
      let needsLeadingEol = false;
      if (resolved.exists) {
        const existing = toBytes(await fsp.readFile(resolved.path));
        const firstNewline = existing.indexOf(0x0a);
        // Giữ kiểu xuống dòng sẵn có (CRLF nếu dòng đầu kết thúc bằng \r\n); thêm xuống dòng cuối nếu file thiếu.
        if (firstNewline > 0 && existing[firstNewline - 1] === 0x0d) eol = '\r\n';
        needsLeadingEol = existing.length > 0 && existing[existing.length - 1] !== 0x0a;
      }
      await fsp.appendFile(resolved.path, encodeUtf8(`${needsLeadingEol ? eol : ''}${line}${eol}`));
    } catch (error) {
      throw ioError('Không ghi được .gitignore', error);
    }
  }

  // MARK: - Thùng rác của app

  async trashUntracked(relatives: readonly string[]): Promise<string> {
    if (relatives.length === 0)
      throw new AdapterError('policy', 'Danh sách file cần dời vào thùng rác đang rỗng.');
    const roots = await this.roots();
    const trashRoot = join(roots.commonDir, 'thaigit', 'trash');

    // Kiểm hết trước khi dời gì: một đường dẫn xấu thì không file nào bị đụng tới.
    const leaves = new Map<string, string>();
    for (const relative of relatives) leaves.set(relative, await this.resolveLeaf(roots.root, relative));
    const requested = [...leaves.keys()];
    // Mục nằm trong một thư mục cũng được dời thì đi theo thư mục đó, không dời hai lần.
    const items = requested.filter(
      (relative) => !requested.some((other) => other !== relative && relative.startsWith(`${other}/`)),
    );

    await this.pruneTrash(trashRoot);
    const token = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const trashDir = join(trashRoot, token);
    const moved: { from: string; to: string }[] = [];
    try {
      for (const relative of items) {
        const from = leaves.get(relative);
        if (from === undefined) continue;
        const to = join(trashDir, 'files', ...relative.split('/'));
        await fsp.mkdir(dirname(to), { recursive: true });
        await moveEntry(from, to);
        moved.push({ from, to });
      }
      const manifest: TrashManifest = { version: 1, createdAt: new Date().toISOString(), items };
      await fsp.writeFile(join(trashDir, 'manifest.json'), JSON.stringify(manifest));
    } catch (error) {
      // Hoàn lại những gì đã dời để không mất file khi lỗi giữa chừng.
      for (const entry of moved.reverse()) await moveEntry(entry.to, entry.from).catch(() => undefined);
      await fsp.rm(trashDir, { recursive: true, force: true }).catch(() => undefined);
      throw ioError('Không dời được file vào thùng rác', error);
    }
    return token;
  }

  async restoreTrash(token: string): Promise<void> {
    if (!TRASH_TOKEN.test(token)) throw new AdapterError('policy', 'Token thùng rác không hợp lệ.');
    const roots = await this.roots();
    const trashDir = join(roots.commonDir, 'thaigit', 'trash', token);
    const items = await this.readManifestItems(trashDir, token);

    // Kiểm hết trước khi dời: không ghi đè file đang có, nguồn phải còn đủ.
    const plan: { from: string; to: string }[] = [];
    for (const relative of items) {
      const segments = relative.split('/');
      const to = join(roots.root, ...segments);
      const from = join(trashDir, 'files', ...segments);
      await this.assertInsideRoot(roots.root, dirname(to), relative);
      if (await pathExists(to))
        throw new AdapterError(
          'conflict',
          `"${relative}" đã tồn tại trong repo; không ghi đè khi khôi phục.`,
        );
      if (!(await pathExists(from)))
        throw new AdapterError('not-found', `Thùng rác không còn "${relative}".`);
      plan.push({ from, to });
    }
    try {
      for (const entry of plan) {
        await fsp.mkdir(dirname(entry.to), { recursive: true });
        await moveEntry(entry.from, entry.to);
      }
      await fsp.rm(trashDir, { recursive: true, force: true });
    } catch (error) {
      throw ioError('Không khôi phục được từ thùng rác', error);
    }
  }

  private async readManifestItems(trashDir: string, token: string): Promise<string[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeUtf8(toBytes(await fsp.readFile(join(trashDir, 'manifest.json')))));
    } catch (error) {
      if (isMissing(error)) throw new AdapterError('not-found', `Không có thùng rác "${token}".`);
      throw ioError('Thùng rác hỏng', error);
    }
    const items = (parsed as { items?: unknown } | null)?.items;
    if (!Array.isArray(items) || !items.every((item): item is string => typeof item === 'string')) {
      throw new AdapterError('io', `Danh sách thùng rác "${token}" hỏng.`);
    }
    for (const item of items) {
      // Manifest nằm trong git dir nhưng vẫn kiểm lại như đầu vào không tin cậy.
      if (checkRelativePath(item, WINDOWS) !== null || hasGitComponent(item)) {
        throw new AdapterError('out-of-scope', `Đường dẫn "${item}" trong thùng rác không hợp lệ.`);
      }
    }
    return items;
  }

  /** Dọn thùng rác cũ (best-effort: việc dọn nền không được làm hỏng thao tác của người dùng). */
  private async pruneTrash(trashRoot: string): Promise<void> {
    const cutoff = Date.now() - this.retentionMs;
    let names: string[];
    try {
      names = await fsp.readdir(trashRoot);
    } catch {
      return;
    }
    for (const name of names) {
      const dir = join(trashRoot, name);
      try {
        const stat = await fsp.stat(dir);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        // Bỏ qua: sẽ thử lại ở lần dọn sau.
      }
    }
  }

  // MARK: - Phạm vi

  private roots(): Promise<Roots> {
    this.rootsPromise ??= (async () => {
      try {
        const [root, gitDir, commonDir] = await Promise.all([
          fsp.realpath(this.options.root),
          fsp.realpath(this.options.gitDir),
          fsp.realpath(this.options.commonDir),
        ]);
        return { root, gitDir, commonDir };
      } catch (error) {
        throw ioError('Không xác định được thư mục repo', error);
      }
    })();
    return this.rootsPromise;
  }

  /** Phân giải một đường dẫn tương đối trong gốc working tree hoặc git dir, kiểm phạm vi sau khi giải symlink. */
  private async resolve(baseKind: 'root' | 'gitDir', relative: string): Promise<Resolved> {
    const reason = checkRelativePath(relative, WINDOWS);
    if (reason !== null)
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" bị từ chối: ${reason}.`);
    if (baseKind === 'root' && hasGitComponent(relative)) {
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" nằm trong .git.`);
    }
    const base = (await this.roots())[baseKind];
    const joined = join(base, ...relative.split('/'));
    let real: string;
    let exists = true;
    try {
      real = await fsp.realpath(joined);
    } catch (error) {
      if (!isMissing(error)) throw ioError(`Không phân giải được ${relative}`, error);
      exists = false;
      try {
        real = join(await fsp.realpath(dirname(joined)), basename(joined));
      } catch (parentError) {
        if (isMissing(parentError)) {
          // Thư mục cha chưa có: đọc → "không có file", ghi/trash → báo không tìm thấy.
          return { path: joined, exists: false };
        }
        throw ioError(`Không phân giải được ${relative}`, parentError);
      }
    }
    const inside = relativeTo(base, real, this.caseInsensitive);
    if (inside === null || inside === '') {
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" trỏ ra ngoài phạm vi repo.`);
    }
    if (baseKind === 'root' && hasGitComponent(inside)) {
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" trỏ vào .git.`);
    }
    return { path: real, exists };
  }

  /** Mục cần dời vào thùng rác: kiểm thư mục cha nằm trong repo, trả đường dẫn của CHÍNH mục đó (không theo symlink). */
  private async resolveLeaf(root: string, relative: string): Promise<string> {
    const reason = checkRelativePath(relative, WINDOWS);
    if (reason !== null)
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" bị từ chối: ${reason}.`);
    if (hasGitComponent(relative))
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" nằm trong .git.`);
    const segments = relative.split('/');
    const leafName = segments.pop() ?? '';
    const parent = join(root, ...segments);
    let realParent: string;
    try {
      realParent = await fsp.realpath(parent);
    } catch (error) {
      if (isMissing(error)) throw new AdapterError('not-found', `Không có "${relative}".`);
      throw ioError(`Không phân giải được ${relative}`, error);
    }
    const insideParent = relativeTo(root, realParent, this.caseInsensitive);
    if (insideParent === null || hasGitComponent(insideParent)) {
      throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" trỏ ra ngoài phạm vi repo.`);
    }
    const leaf = join(realParent, leafName);
    try {
      await fsp.lstat(leaf);
    } catch (error) {
      if (isMissing(error)) throw new AdapterError('not-found', `Không có "${relative}".`);
      throw ioError(`Không đọc được ${relative}`, error);
    }
    return leaf;
  }

  /** Tổ tiên tồn tại gần nhất của `directory` phải nằm trong gốc repo (trước khi tạo thư mục thiếu). */
  private async assertInsideRoot(root: string, directory: string, relative: string): Promise<void> {
    let probe = directory;
    for (;;) {
      try {
        const real = await fsp.realpath(probe);
        const inside = relativeTo(root, real, this.caseInsensitive);
        if (inside === null || hasGitComponent(inside)) {
          throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" trỏ ra ngoài phạm vi repo.`);
        }
        return;
      } catch (error) {
        if (!isMissing(error)) throw ioError(`Không phân giải được ${relative}`, error);
        const parent = dirname(probe);
        if (parent === probe)
          throw new AdapterError('out-of-scope', `Đường dẫn "${relative}" trỏ ra ngoài phạm vi repo.`);
        probe = parent;
      }
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fsp.lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw ioError(`Không đọc được ${path}`, error);
  }
}

/** Dời một mục (file/thư mục/symlink): cùng ổ → rename; khác ổ (EXDEV) → sao chép rồi xoá nguồn. */
async function moveEntry(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') throw error;
    await fsp.cp(from, to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    await fsp.rm(from, { recursive: true });
  }
}
