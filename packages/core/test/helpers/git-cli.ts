// Chạy git THẬT trong thư mục tạm để test patch/conflict theo byte. Chỉ dùng trong test (Node).
// Cô lập hoàn toàn khỏi máy: HOME + cấu hình toàn cục/hệ thống bị vô hiệu, chỉ làm việc trong os.tmpdir().
// Cờ `-c` và env chuẩn lấy từ chính sách chung (`buildGitArgv`/`buildGitEnv`) nên khớp hành vi trong app.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { buildGitArgv, buildGitEnv } from '@thaigit/contracts';

const SANDBOX_PREFIX = 'thaigit-core-';

export interface GitResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface GitRunOptions {
  readonly stdin?: Uint8Array;
  readonly env?: Readonly<Record<string, string>>;
  /** Mặc định ném lỗi khi git thoát khác 0. */
  readonly allowFailure?: boolean;
}

export type AutoCrlf = 'true' | 'input' | 'false';

export interface TempRepoOptions {
  readonly autocrlf?: AutoCrlf;
}

export class GitCommandError extends Error {
  constructor(
    readonly argv: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${argv.join(' ')} thoát với mã ${result.code}: ${result.stderr}`);
  }
}

/** Repo git tạm, cô lập. Gọi `cleanup()` ở cuối (afterAll/afterEach). */
export class TempRepo {
  readonly dir: string;
  private readonly root: string;
  private readonly env: Record<string, string>;

  private constructor(root: string, dir: string, env: Record<string, string>) {
    this.root = root;
    this.dir = dir;
    this.env = env;
  }

  static create(options: TempRepoOptions = {}): TempRepo {
    const root = mkdtempSync(join(tmpdir(), SANDBOX_PREFIX));
    const dir = join(root, 'repo');
    const home = join(root, 'home');
    mkdirSync(dir);
    mkdirSync(home);
    const repo = new TempRepo(root, dir, TempRepo.makeEnv(root, home));
    // `--template=` rỗng: không chép hook mẫu, init nhanh hơn và repo gọn hơn khi sao chép.
    repo.git('init', ['-q', '-b', 'main', '--template=']);
    // Ghi cấu hình thẳng vào .git/config (đỡ vài lần spawn git); giá trị ghi sau thắng giá trị ghi trước.
    repo.appendConfig(
      '[user]\n\tname = Thaigit Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tsafecrlf = false\n',
    );
    if (options.autocrlf !== undefined) repo.setAutocrlf(options.autocrlf);
    return repo;
  }

  private static makeEnv(root: string, home: string): Record<string, string> {
    return {
      ...buildGitEnv(process.env, { profile: 'background' }),
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CEILING_DIRECTORIES: root,
      GIT_LITERAL_PATHSPECS: '1',
    };
  }

  /** Sao chép nguyên repo này (cả .git) sang một thư mục tạm mới, độc lập — rẻ hơn dựng lại bằng nhiều lệnh git. */
  fork(): TempRepo {
    const root = mkdtempSync(join(tmpdir(), SANDBOX_PREFIX));
    const dir = join(root, 'repo');
    const home = join(root, 'home');
    cpSync(this.dir, dir, { recursive: true });
    mkdirSync(home);
    return new TempRepo(root, dir, TempRepo.makeEnv(root, home));
  }

  /** Thêm đoạn cấu hình vào .git/config của repo tạm. */
  appendConfig(text: string): void {
    appendFileSync(join(this.dir, '.git', 'config'), text);
  }

  setAutocrlf(value: AutoCrlf): void {
    this.appendConfig(`[core]\n\tautocrlf = ${value}\n`);
  }

  /** Chạy `git <sub> <args…>` qua `buildGitArgv` (có cờ -c chuẩn, --no-ext-diff cho lệnh diff). */
  git(sub: string, args: readonly string[] = [], options: GitRunOptions = {}): GitResult {
    const argv = buildGitArgv(sub, args);
    const run = spawnSync('git', argv, {
      cwd: this.dir,
      env: { ...this.env, ...options.env },
      input: options.stdin,
      maxBuffer: 512 * 1024 * 1024,
      encoding: 'buffer',
    });
    if (run.error) throw run.error;
    const result: GitResult = {
      code: run.status ?? -1,
      stdout: Uint8Array.from(run.stdout),
      stderr: run.stderr.toString('utf8'),
    };
    if (result.code !== 0 && !options.allowFailure) throw new GitCommandError(argv, result);
    return result;
  }

  // MARK: - File

  writeFile(relative: string, content: Uint8Array | string): void {
    const target = join(this.dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  readFile(relative: string): Uint8Array {
    return Uint8Array.from(readFileSync(join(this.dir, relative)));
  }

  removeFile(relative: string): void {
    unlinkSync(join(this.dir, relative));
  }

  // MARK: - Lệnh git hay dùng (cùng dòng lệnh với app)

  add(...paths: string[]): void {
    this.git('add', ['--', ...paths]);
  }

  commit(message: string): void {
    this.git('commit', ['-q', '--no-verify', '-m', message]);
  }

  /** Nội dung blob trong index (byte thô, không qua bộ lọc). */
  indexBlob(relative: string): Uint8Array {
    return this.git('cat-file', ['blob', `:${relative}`]).stdout;
  }

  headBlob(relative: string): Uint8Array {
    return this.git('cat-file', ['blob', `HEAD:${relative}`]).stdout;
  }

  /** Như `workingDiff` của app: diff index→worktree (unstaged) hoặc HEAD→index (staged), trả byte thô. */
  diffBytes(kind: 'unstaged' | 'staged', relative: string, context = 3): Uint8Array {
    const common = ['--no-color', '--no-ext-diff', `-U${context}`, '--src-prefix=a/', '--dst-prefix=b/'];
    const args =
      kind === 'staged' ? ['--cached', '-M', ...common, '--', relative] : [...common, '--', relative];
    return this.git('diff', args).stdout;
  }

  /** Như `applyPatch` của app: patch là byte, truyền qua stdin, không giải mã. */
  applyPatch(patch: Uint8Array, options: { cached: boolean; reverse: boolean }): GitResult {
    const args = ['--whitespace=nowarn', '--recount'];
    if (options.cached) args.push('--cached');
    if (options.reverse) args.push('--reverse');
    args.push('-');
    return this.git('apply', args, { stdin: patch, allowFailure: true });
  }

  cleanup(): void {
    // Chỉ xoá thư mục do chính helper này tạo trong thư mục tạm của hệ điều hành.
    const inTmp = realpathSync(dirname(this.root)) === realpathSync(tmpdir());
    if (!inTmp || !basename(this.root).startsWith(SANDBOX_PREFIX)) {
      throw new Error(`Từ chối xoá thư mục ngoài vùng tạm: ${this.root}`);
    }
    rmSync(this.root, { recursive: true, force: true });
  }
}

// MARK: - So sánh byte dễ đọc

/** Chuỗi hiển thị byte: ASCII in được giữ nguyên, \r \n \t escape, còn lại \xNN — để lỗi test đọc được. */
export function showBytes(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte === 0x0d) out += '\\r';
    else if (byte === 0x0a) out += '\\n\n';
    else if (byte === 0x09) out += '\\t';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Byte từ chuỗi "latin1" (mỗi ký tự = một byte) — dựng nội dung CP1252/CP1258 trong test. */
export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
