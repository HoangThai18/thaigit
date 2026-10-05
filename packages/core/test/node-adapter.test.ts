import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterError, CancelledError, GitError, RepositoryError } from '../src/git/index.ts';
import {
  NodeExec,
  NodeGitHost,
  NodeRepoFs,
  NodeTypedGit,
  isAllowedConfigKey,
  locateRepository,
  openRepository,
} from '../src/node/index.ts';
import { spawnGit } from '../src/node/process.ts';
import {
  IS_WINDOWS,
  createHangScript,
  fileExists,
  isProcessAlive,
  isolatedConfig,
  rawGit,
  waitFor,
  withTempDir,
  withTestRepo,
  writeExecutableScript,
  type TestRepo,
} from './helpers/test-repo.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256')
    .update(typeof bytes === 'string' ? enc.encode(bytes) : bytes)
    .digest('hex');

async function execFor(t: TestRepo): Promise<NodeExec> {
  const repo = t.repo;
  return new NodeExec({ ...t.config, cwd: repo.root, gitDir: repo.gitDir });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Mong đợi bị từ chối nhưng lại thành công');
    },
    (error: unknown) => error,
  );
}

describe('NodeExec: chính sách', () => {
  it('từ chối lệnh vi phạm TRƯỚC khi chạy git (không có tác dụng phụ) và báo lỗi mã "policy"', () =>
    withTestRepo(async (t) => {
      const exec = await execFor(t);
      const marker = join(t.root, 'pwned');
      const script = await writeExecutableScript(join(t.root, 'evil.sh'), `touch "${marker}"`);
      const cases: { sub: string; args: string[]; env?: Record<string, string>; code: string }[] = [
        { sub: 'status', args: ['-c', `core.fsmonitor=${script}`], code: 'flag-rejected' },
        { sub: 'status', args: [`-ccore.fsmonitor=${script}`], code: 'flag-rejected' },
        { sub: 'fetch', args: [`--upload-pack=${script}`, 'origin'], code: 'flag-rejected' },
        { sub: 'fetch', args: ['ext::sh -c id', 'main'], code: 'url-rejected' },
        { sub: 'submodule', args: ['foreach', 'touch pwned'], code: 'second-not-allowed' },
        { sub: 'config', args: ['core.fsmonitor', script], code: 'config-write' },
        { sub: 'remote', args: ['add', 'x', 'https://example.com'], code: 'typed-only' },
        { sub: 'status', args: [], env: { GIT_SSH_COMMAND: script }, code: 'env-rejected' },
      ];
      for (const item of cases) {
        const error = await rejection(
          exec.run({ kind: 'read', sub: item.sub, args: item.args, env: item.env }),
        );
        expect(error, `${item.sub} ${item.args.join(' ')}`).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).code).toBe('policy');
        expect((error as AdapterError).violation?.code).toBe(item.code);
        expect((error as AdapterError).message).toContain('bị chính sách chặn');
      }
      expect(await t.exists('pwned')).toBe(false);
    }));

  it('chấp nhận lệnh hợp lệ, env GIT_OPTIONAL_LOCKS/GIT_LITERAL_PATHSPECS, và chèn --no-ext-diff cho lệnh sinh diff', () =>
    withTestRepo(async (t) => {
      const exec = await execFor(t);
      await t.write('a.txt', '1\n');
      await t.commitAll('init');
      await t.write('a.txt', '2\n');
      const status = await exec.run({
        kind: 'read',
        sub: 'status',
        args: ['--porcelain=v2', '-z'],
        env: { GIT_OPTIONAL_LOCKS: '0' },
      });
      expect(status.code).toBe(0);
      expect(dec.decode(status.stdout)).toContain(' a.txt');
      const diff = await exec.run({
        kind: 'read',
        sub: 'diff',
        args: ['--', 'a.txt'],
        env: { GIT_LITERAL_PATHSPECS: '1' },
      });
      expect(dec.decode(diff.stdout)).toContain('+2');
      // The global -c flags really do apply: color.ui=false even though the repo config enables colour.
      t.git('config', 'color.ui', 'always');
      const colored = await exec.run({ kind: 'read', sub: 'diff', args: ['--', 'a.txt'] });
      expect(dec.decode(colored.stdout)).not.toContain('\u001b[');
    }));

  it('output luôn tiếng Anh dù môi trường gốc đặt LC_ALL/LANG khác', () =>
    withTestRepo(async (t) => {
      const config = isolatedConfig({ LC_ALL: 'de_DE.UTF-8', LANG: 'vi_VN.UTF-8', LANGUAGE: 'de' });
      const exec = new NodeExec({ ...config, cwd: t.root });
      const result = await exec.run({ kind: 'read', sub: 'rev-parse', args: ['--verify', 'khong-co-ref'] });
      expect(result.code).not.toBe(0);
      expect(dec.decode(result.stderr)).toMatch(/needed a single revision|Needed a single revision/);
    }));

  it('GIT_INDEX_FILE chỉ nhận đường dẫn nằm trong git dir', () =>
    withTestRepo(async (t) => {
      const exec = await execFor(t);
      await t.write('a.txt', 'x\n');
      const inside = join(t.repo.gitDir, 'tmp-index');
      const ok = await exec.run({
        kind: 'write',
        sub: 'add',
        args: ['a.txt'],
        env: { GIT_INDEX_FILE: inside },
      });
      expect(ok.code).toBe(0);
      expect((await stat(inside)).isFile()).toBe(true);
      for (const outside of [
        join(t.root, 'index2'),
        '/tmp/nope-index',
        join(t.repo.gitDir, '..', 'index3'),
        join(t.repo.gitDir, 'no-dir', 'index'),
      ]) {
        const error = await rejection(
          exec.run({ kind: 'write', sub: 'add', args: ['a.txt'], env: { GIT_INDEX_FILE: outside } }),
        );
        expect((error as AdapterError).violation?.code, outside).toBe('env-rejected');
      }
    }));

  it('thư mục chạy không tồn tại → not-found (không nhầm với thiếu git)', async () => {
    await withTempDir(async (dir) => {
      const exec = new NodeExec({ ...isolatedConfig(), cwd: join(dir, 'da-xoa') });
      const error = await rejection(exec.run({ kind: 'read', sub: 'status', args: [] }));
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('not-found');
    });
  });

  it('git không chạy được → AdapterError git-missing', async () => {
    await withTempDir(async (dir) => {
      const exec = new NodeExec({ ...isolatedConfig(), gitPath: join(dir, 'khong-co-git'), cwd: dir });
      const error = await rejection(exec.run({ kind: 'read', sub: 'status', args: [] }));
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('git-missing');
    });
  });
});

describe.skipIf(IS_WINDOWS)('NodeExec/spawnGit: tiến trình, stderr, huỷ', () => {
  it('callback tiến trình ném lỗi: git chạy nốt rồi lỗi đó được báo cho người gọi (không làm sập Node)', async () => {
    const error = new Error('callback hỏng');
    let calls = 0;
    const failure = await spawnGit({
      gitPath: '/bin/sh',
      argv: ['-c', 'printf "a\\nb\\nc\\n" >&2; sleep 0.1; printf xong'],
      cwd: '/',
      env: { PATH: process.env.PATH ?? '' },
      cancellable: false,
      onStderrLine: () => {
        calls += 1;
        throw error;
      },
    }).catch((e: unknown) => e);
    expect(failure).toBe(error);
    expect(calls).toBe(3);
  });

  it('tách dòng stderr theo \\r và \\n, giữ nguyên byte, bỏ dòng rỗng; stdin là byte', async () => {
    const lines: Uint8Array[] = [];
    const result = await spawnGit({
      gitPath: '/bin/sh',
      argv: ['-c', 'cat >&2; printf "x\\ry\\nz\\r\\nw" >&2; printf out'],
      cwd: '/',
      env: { PATH: process.env.PATH ?? '' },
      stdin: Uint8Array.from([0xc3, 0xa9, 0x0a, 0xff, 0x00, 0x0d]),
      cancellable: false,
      onStderrLine: (line) => lines.push(line),
    });
    expect(result.code).toBe(0);
    expect(dec.decode(result.stdout)).toBe('out');
    expect(lines.map((line) => Array.from(line))).toEqual([
      [0xc3, 0xa9],
      [0xff, 0x00],
      [0x78],
      [0x79],
      [0x7a],
      [0x77],
    ]);
    expect(lines.every((line) => Object.getPrototypeOf(line) === Uint8Array.prototype)).toBe(true);
    expect(Array.from(result.stderr.subarray(0, 6))).toEqual([0xc3, 0xa9, 0x0a, 0xff, 0x00, 0x0d]);
  });

  it('huỷ lệnh network: SIGTERM, mã thoát thật (143), cancelled = true', async () => {
    await withTempDir(async (dir) => {
      const slow = await writeExecutableScript(join(dir, 'slow-git.sh'), 'exec sleep 30');
      const exec = new NodeExec({ ...isolatedConfig(), gitPath: slow, cwd: dir });
      const controller = new AbortController();
      const started = performance.now();
      const pending = exec.run({ kind: 'network', sub: 'fetch', args: ['--all'], signal: controller.signal });
      setTimeout(() => controller.abort(), 150);
      const result = await pending;
      expect(result.cancelled).toBe(true);
      expect(result.code).toBe(143);
      expect(performance.now() - started).toBeLessThan(5000);
    });
  });

  it('SIGTERM bị bỏ qua → SIGKILL sau thời gian chờ (137)', async () => {
    await withTempDir(async (dir) => {
      const ready = join(dir, 'san-sang');
      const stubborn = await writeExecutableScript(
        join(dir, 'stubborn.sh'),
        `trap "" TERM\ntouch "${ready}"\nwhile true; do sleep 0.05; done`,
      );
      const exec = new NodeExec({ ...isolatedConfig(), gitPath: stubborn, cwd: dir, killGraceMs: 200 });
      const controller = new AbortController();
      const pending = exec.run({
        kind: 'network',
        sub: 'push',
        args: ['origin', 'main'],
        signal: controller.signal,
      });
      // Cancel only after the script has installed its trap (the first run of the file can be slow because of OS security scanning).
      await waitFor(() => fileExists(ready));
      controller.abort();
      const result = await pending;
      expect(result).toMatchObject({ cancelled: true, code: 137 });
    });
  });

  it('chỉ lệnh network huỷ được: lệnh read/write chạy tới cùng dù signal đã huỷ', async () => {
    await withTempDir(async (dir) => {
      const quick = await writeExecutableScript(join(dir, 'quick.sh'), 'sleep 0.2; echo xong');
      const exec = new NodeExec({ ...isolatedConfig(), gitPath: quick, cwd: dir });
      const controller = new AbortController();
      controller.abort();
      for (const kind of ['read', 'write'] as const) {
        const result = await exec.run({
          kind,
          sub: kind === 'read' ? 'status' : 'add',
          args: [],
          signal: controller.signal,
        });
        expect(result).toMatchObject({ cancelled: false, code: 0 });
        expect(dec.decode(result.stdout)).toBe('xong\n');
      }
    });
  });

  it('signal đã huỷ sẵn với lệnh network: không spawn, báo huỷ', async () => {
    await withTempDir(async (dir) => {
      const marker = join(dir, 'da-chay');
      const script = await writeExecutableScript(join(dir, 'g.sh'), `touch "${marker}"`);
      const exec = new NodeExec({ ...isolatedConfig(), gitPath: script, cwd: dir });
      const result = await exec.run({ kind: 'network', sub: 'fetch', args: [], signal: AbortSignal.abort() });
      expect(result.cancelled).toBe(true);
      await expect(lstat(marker)).rejects.toThrow();
    });
  });

  it('huỷ fetch thật qua GIT_SSH_COMMAND treo: CancelledError với mã thoát của git, không để lại tiến trình mồ côi', () =>
    withTestRepo(async (t) => {
      const hang = await createHangScript(join(t.root, '..'), 'hang-ssh');
      const config = isolatedConfig({ GIT_SSH_COMMAND: hang.script });
      const repo = await openRepository(t.root, config);
      t.git('remote', 'add', 'origin', 'ssh://localhost/khong-ton-tai.git');
      const controller = new AbortController();
      const pending = repo.fetch({ signal: controller.signal });
      // Cancel only once git has actually launched ssh (a child process is hanging): exactly the "slow network" situation.
      const sshPid = await hang.pid();
      expect(isProcessAlive(sshPid)).toBe(true);
      controller.abort();
      const error = await rejection(pending);
      expect(error).toBeInstanceOf(CancelledError);
      expect((error as CancelledError).exitCode).toBe(143);
      // Cancelling kills the whole process group, so ssh is not left orphaned.
      await waitFor(() => !isProcessAlive(sshPid), 5000);
    }));
});

describe('NodeRepoFs: phạm vi', () => {
  async function fsFor(t: TestRepo, trashRetentionMs?: number): Promise<NodeRepoFs> {
    return new NodeRepoFs({
      root: t.repo.root,
      gitDir: t.repo.gitDir,
      commonDir: t.repo.commonDir,
      trashRetentionMs,
    });
  }

  it('từ chối "..", đường dẫn tuyệt đối, đoạn rỗng/"." và NUL cho mọi thao tác', () =>
    withTestRepo(async (t) => {
      const fs = await fsFor(t);
      await t.write('ok.txt', 'ok');
      const bad = ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', 'a//b', './ok.txt', '', 'a\0b'];
      for (const path of bad) {
        for (const operation of [
          () => fs.readWorktreeFile(path),
          () => fs.writeWorktreeFile(path, enc.encode('x'), null),
          () => fs.trashUntracked([path]),
        ]) {
          const error = await rejection(operation());
          expect(error, JSON.stringify(path)).toBeInstanceOf(AdapterError);
          expect((error as AdapterError).code).toBe('out-of-scope');
        }
      }
      expect(dec.decode((await fs.readWorktreeFile('ok.txt')) ?? new Uint8Array(0))).toBe('ok');
    }));

  it.skipIf(IS_WINDOWS)(
    'từ chối symlink trỏ ra ngoài repo (file lẫn thư mục), cho phép symlink trỏ vào trong',
    () =>
      withTestRepo(async (t) => {
        const fs = await fsFor(t);
        const outside = join(t.root, '..', 'ben-ngoai');
        await mkdir(outside);
        await writeFile(join(outside, 'bi-mat.txt'), 'BÍ MẬT');
        await symlink(join(outside, 'bi-mat.txt'), join(t.root, 'link-file'));
        await symlink(outside, join(t.root, 'link-dir'));
        await t.write('thuc.txt', 'trong repo');
        await symlink('thuc.txt', join(t.root, 'link-trong'));
        await symlink('../ben-ngoai', join(t.root, 'link-tuong-doi'));

        for (const path of ['link-file', 'link-dir/bi-mat.txt', 'link-tuong-doi/bi-mat.txt']) {
          for (const operation of [
            () => fs.readWorktreeFile(path),
            () => fs.writeWorktreeFile(path, enc.encode('ghi'), sha256('BÍ MẬT')),
          ]) {
            const error = await rejection(operation());
            expect((error as AdapterError).code, path).toBe('out-of-scope');
          }
        }
        // Moving to the trash: going through a symlinked directory that points outside is blocked; the symlink itself is an
        // entry inside the repo, so only the link moves — the file it targets is NOT touched.
        for (const path of ['link-dir/bi-mat.txt', 'link-tuong-doi/bi-mat.txt']) {
          expect(((await rejection(fs.trashUntracked([path]))) as AdapterError).code, path).toBe(
            'out-of-scope',
          );
        }
        const token = await fs.trashUntracked(['link-file', 'link-dir']);
        expect(await readFile(join(outside, 'bi-mat.txt'), 'utf8')).toBe('BÍ MẬT');
        expect(await lstat(join(t.root, 'link-file')).catch(() => null)).toBeNull();
        await fs.restoreTrash(token);
        expect((await lstat(join(t.root, 'link-file'))).isSymbolicLink()).toBe(true);
        expect((await lstat(join(t.root, 'link-dir'))).isSymbolicLink()).toBe(true);
        // Writing a new file under a symlinked directory pointing outside is blocked too, and nothing is created outside the repo.
        const error = await rejection(fs.writeWorktreeFile('link-dir/moi.txt', enc.encode('x'), null));
        expect((error as AdapterError).code).toBe('out-of-scope');
        expect(await readdir(outside)).toEqual(['bi-mat.txt']);
        expect(await readFile(join(outside, 'bi-mat.txt'), 'utf8')).toBe('BÍ MẬT');
        // A symlink pointing inside the repo still works.
        expect(dec.decode((await fs.readWorktreeFile('link-trong')) ?? new Uint8Array(0))).toBe('trong repo');
      }),
  );

  it('không bao giờ chạm vào .git qua đường working tree (kể cả hoa/thường, tên ngắn NTFS, symlink vào .git)', () =>
    withTestRepo(async (t) => {
      const fs = await fsFor(t);
      await t.write('sub/x.txt', 'x');
      const targets = [
        '.git/hooks/pre-commit',
        '.git/config',
        '.GIT/config',
        '.Git/HEAD',
        'sub/.git/hooks/x',
        '.git./config',
        'GIT~1/config',
      ];
      for (const path of targets) {
        for (const operation of [
          () => fs.readWorktreeFile(path),
          () => fs.writeWorktreeFile(path, enc.encode('#!/bin/sh\ntouch /tmp/pwned\n'), null),
        ]) {
          const error = await rejection(operation());
          expect(error, path).toBeInstanceOf(AdapterError);
          expect((error as AdapterError).code, path).toBe('out-of-scope');
        }
      }
      if (!IS_WINDOWS) {
        await symlink('.git', join(t.root, 'loi-vao-git'));
        const error = await rejection(
          fs.writeWorktreeFile('loi-vao-git/hooks/post-checkout', enc.encode('x'), null),
        );
        expect((error as AdapterError).code).toBe('out-of-scope');
        expect(await t.exists('.git/hooks/post-checkout')).toBe(false);
      }
      expect(await rejection(fs.trashUntracked(['.git/HEAD']))).toBeInstanceOf(AdapterError);
      // `.gitignore`, `.github/…` are not `.git`.
      await fs.appendGitignore('node_modules/');
      await t.write('.github/workflows/ci.yml', 'name: ci\n');
      expect(await fs.readWorktreeFile('.github/workflows/ci.yml')).not.toBeNull();
    }));

  it('readGitFile chỉ đọc danh sách cho phép; không có file → null', () =>
    withTestRepo(async (t) => {
      const fs = await fsFor(t);
      expect(await fs.readGitFile('MERGE_HEAD')).toBeNull();
      expect(await fs.readGitFile('rebase-merge/head-name')).toBeNull();
      expect(await fs.readGitFile('rebase-apply/applying')).toBeNull();
      await writeFile(join(t.repo.gitDir, 'MERGE_MSG'), 'Merge branch x\n');
      expect(dec.decode((await fs.readGitFile('MERGE_MSG')) ?? new Uint8Array(0))).toBe('Merge branch x\n');
      for (const path of [
        'config',
        'HEAD',
        'hooks/pre-commit',
        'rebase-merge/../config',
        'rebase-merge/',
        '../MERGE_HEAD',
        '/etc/passwd',
        'objects/pack/x',
      ]) {
        const error = await rejection(fs.readGitFile(path));
        expect(error, path).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).code, path).toBe('out-of-scope');
      }
      if (!IS_WINDOWS) {
        await mkdir(join(t.repo.gitDir, 'rebase-merge'));
        await symlink('/etc/hosts', join(t.repo.gitDir, 'rebase-merge', 'head-name'));
        expect(((await rejection(fs.readGitFile('rebase-merge/head-name'))) as AdapterError).code).toBe(
          'out-of-scope',
        );
      }
    }));

  it('readWorktreeFile: không có → null; vượt maxBytes và thư mục → lỗi io', () =>
    withTestRepo(async (t) => {
      const fs = await fsFor(t);
      await t.write('lon.bin', new Uint8Array(1000));
      await t.write('thu-muc/a.txt', 'a');
      expect(await fs.readWorktreeFile('khong-co.txt')).toBeNull();
      expect(await fs.readWorktreeFile('khong-co/a/b.txt')).toBeNull();
      expect((await fs.readWorktreeFile('lon.bin', 1000))?.length).toBe(1000);
      expect(((await rejection(fs.readWorktreeFile('lon.bin', 999))) as AdapterError).code).toBe('io');
      expect(((await rejection(fs.readWorktreeFile('thu-muc'))) as AdapterError).code).toBe('io');
    }));
});

describe('NodeRepoFs: ghi CAS theo byte', () => {
  const fsFor = (t: TestRepo) =>
    new NodeRepoFs({ root: t.repo.root, gitDir: t.repo.gitDir, commonDir: t.repo.commonDir });

  it('ghi khi sha256 khớp; lệch → conflict, file không đổi và không để lại file tạm', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      await t.write('a.txt', 'bản gốc\n');
      const original = (await fs.readWorktreeFile('a.txt')) ?? new Uint8Array(0);
      await fs.writeWorktreeFile('a.txt', enc.encode('bản mới\n'), sha256(original));
      expect(await t.read('a.txt')).toBe('bản mới\n');

      // The user edited the file outside the app while the app held the old version.
      await t.write('a.txt', 'sửa ngoài app\n');
      const error = await rejection(
        fs.writeWorktreeFile('a.txt', enc.encode('app ghi đè\n'), sha256(original)),
      );
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('conflict');
      expect(await t.read('a.txt')).toBe('sửa ngoài app\n');
      expect((await readdir(t.root)).filter((name) => name.includes('.tmp'))).toEqual([]);

      // An uppercase sha still matches; `null` means "the file must not exist".
      await fs.writeWorktreeFile('a.txt', enc.encode('ok\n'), sha256('sửa ngoài app\n').toUpperCase());
      expect(
        ((await rejection(fs.writeWorktreeFile('a.txt', enc.encode('x'), null))) as AdapterError).code,
      ).toBe('conflict');
      expect(
        ((await rejection(fs.writeWorktreeFile('moi.txt', enc.encode('x'), sha256('gì đó')))) as AdapterError)
          .code,
      ).toBe('conflict');
      expect(await t.exists('moi.txt')).toBe(false);
      await fs.writeWorktreeFile('moi.txt', enc.encode('tạo mới\n'), null);
      expect(await t.read('moi.txt')).toBe('tạo mới\n');
      expect(
        (
          (await rejection(
            fs.writeWorktreeFile('khong/co/thu-muc.txt', enc.encode('x'), null),
          )) as AdapterError
        ).code,
      ).toBe('not-found');
    }));

  it('giữ nguyên từng byte: BOM, CRLF, Latin-1/CP1252, NUL, và quyền thực thi', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0xe9, 0xe8, 0xff, 0x00, 0x62, 0x0d]);
      await t.write('nhi-phan.dat', new Uint8Array(0));
      await fs.writeWorktreeFile('nhi-phan.dat', bytes, sha256(new Uint8Array(0)));
      expect(Array.from(await t.readBytes('nhi-phan.dat'))).toEqual(Array.from(bytes));
      expect(Array.from((await fs.readWorktreeFile('nhi-phan.dat')) ?? [])).toEqual(Array.from(bytes));

      if (!IS_WINDOWS) {
        await t.write('chay.sh', '#!/bin/sh\necho 1\n');
        await chmod(join(t.root, 'chay.sh'), 0o755);
        await fs.writeWorktreeFile(
          'chay.sh',
          enc.encode('#!/bin/sh\necho 2\n'),
          sha256('#!/bin/sh\necho 1\n'),
        );
        expect((await stat(join(t.root, 'chay.sh'))).mode & 0o777).toBe(0o755);
        expect(await t.read('chay.sh')).toBe('#!/bin/sh\necho 2\n');
      }
    }));

  it('appendGitignore: theo byte, giữ kiểu xuống dòng, thêm xuống dòng cuối nếu thiếu, giữ BOM', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      await fs.appendGitignore('*.log');
      expect(await t.read('.gitignore')).toBe('*.log\n');

      await t.write('.gitignore', 'build/\nnode_modules');
      await fs.appendGitignore('.env');
      expect(await t.read('.gitignore')).toBe('build/\nnode_modules\n.env\n');

      await t.write('.gitignore', 'a\r\nb\r\n');
      await fs.appendGitignore('c');
      expect(Array.from(await t.readBytes('.gitignore'))).toEqual(Array.from(enc.encode('a\r\nb\r\nc\r\n')));

      await t.write('.gitignore', 'a\r\nb');
      await fs.appendGitignore('thư mục/');
      expect(await t.read('.gitignore')).toBe('a\r\nb\r\nthư mục/\r\n');

      await t.write('.gitignore', Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]));
      await fs.appendGitignore('b');
      expect(Array.from(await t.readBytes('.gitignore'))).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x0a, 0x62, 0x0a]);

      for (const bad of ['', '  ', 'a\nb', 'a\rb', 'a\0b']) {
        expect(((await rejection(fs.appendGitignore(bad))) as AdapterError).code).toBe('policy');
      }
    }));

  it.skipIf(IS_WINDOWS)('appendGitignore qua symlink .gitignore trỏ ra ngoài bị chặn', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      const outside = join(t.root, '..', 'gitignore-ngoai');
      await writeFile(outside, 'x\n');
      await symlink(outside, join(t.root, '.gitignore'));
      expect(((await rejection(fs.appendGitignore('y'))) as AdapterError).code).toBe('out-of-scope');
      expect(await readFile(outside, 'utf8')).toBe('x\n');
    }),
  );
});

describe('NodeRepoFs: thùng rác của app', () => {
  const fsFor = (t: TestRepo, trashRetentionMs?: number) =>
    new NodeRepoFs({
      root: t.repo.root,
      gitDir: t.repo.gitDir,
      commonDir: t.repo.commonDir,
      trashRetentionMs,
    });

  it('dời file/thư mục vào <commonDir>/thaigit/trash/<token>/ rồi khôi phục đúng vị trí', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      await t.write('rác.txt', 'rác\n');
      await t.write('Tài liệu/ghi chú.txt', 'ghi chú\n');
      await t.write('thư mục/chau/sâu.txt', 'sâu\n');
      await t.write('thư mục/anh em.txt', 'anh em\n');
      const token = await fs.trashUntracked([
        'rác.txt',
        'Tài liệu/ghi chú.txt',
        'thư mục',
        'thư mục/chau/sâu.txt',
      ]);
      expect(token).toMatch(/^[0-9A-Za-z._-]+$/);
      for (const path of ['rác.txt', 'Tài liệu/ghi chú.txt', 'thư mục/anh em.txt', 'thư mục/chau/sâu.txt'])
        expect(await t.exists(path), path).toBe(false);
      const trashed = join(t.repo.commonDir, 'thaigit', 'trash', token, 'files');
      expect(await readFile(join(trashed, 'rác.txt'), 'utf8')).toBe('rác\n');
      expect(await readFile(join(trashed, 'thư mục', 'chau', 'sâu.txt'), 'utf8')).toBe('sâu\n');

      await fs.restoreTrash(token);
      expect(await t.read('rác.txt')).toBe('rác\n');
      expect(await t.read('Tài liệu/ghi chú.txt')).toBe('ghi chú\n');
      expect(await t.read('thư mục/chau/sâu.txt')).toBe('sâu\n');
      expect(await t.read('thư mục/anh em.txt')).toBe('anh em\n');
      await expect(stat(join(t.repo.commonDir, 'thaigit', 'trash', token))).rejects.toThrow();
      expect(((await rejection(fs.restoreTrash(token))) as AdapterError).code).toBe('not-found');
    }));

  it('một đường dẫn xấu thì không file nào bị dời; mục không có → not-found; danh sách rỗng bị từ chối', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      await t.write('a.txt', 'a');
      expect(((await rejection(fs.trashUntracked(['a.txt', '../ngoai']))) as AdapterError).code).toBe(
        'out-of-scope',
      );
      expect(((await rejection(fs.trashUntracked(['a.txt', 'khong-co.txt']))) as AdapterError).code).toBe(
        'not-found',
      );
      expect(await t.exists('a.txt')).toBe(true);
      expect(((await rejection(fs.trashUntracked([]))) as AdapterError).code).toBe('policy');
    }));

  it('khôi phục không ghi đè file đang có (conflict) và giữ nguyên thùng rác', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      await t.write('a.txt', 'bản cũ');
      const token = await fs.trashUntracked(['a.txt']);
      await t.write('a.txt', 'bản mới người dùng tạo');
      const error = await rejection(fs.restoreTrash(token));
      expect((error as AdapterError).code).toBe('conflict');
      expect(await t.read('a.txt')).toBe('bản mới người dùng tạo');
      expect(
        await readFile(join(t.repo.commonDir, 'thaigit', 'trash', token, 'files', 'a.txt'), 'utf8'),
      ).toBe('bản cũ');
    }));

  it('token sai định dạng bị từ chối; manifest bị sửa trỏ ra ngoài/vào .git bị từ chối', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      for (const token of ['', '..', '../x', 'a/b', '.hidden', 'a b', 'x'.repeat(200)]) {
        expect(((await rejection(fs.restoreTrash(token))) as AdapterError).code, token).toBe('policy');
      }
      expect(((await rejection(fs.restoreTrash('khong-ton-tai'))) as AdapterError).code).toBe('not-found');
      await t.write('a.txt', 'a');
      const token = await fs.trashUntracked(['a.txt']);
      const manifest = join(t.repo.commonDir, 'thaigit', 'trash', token, 'manifest.json');
      for (const evil of ['../escape.txt', '.git/hooks/pre-commit', '/etc/passwd']) {
        await writeFile(manifest, JSON.stringify({ version: 1, items: [evil] }));
        expect(((await rejection(fs.restoreTrash(token))) as AdapterError).code, evil).toBe('out-of-scope');
      }
      await writeFile(manifest, '{không phải json');
      expect(((await rejection(fs.restoreTrash(token))) as AdapterError).code).toBe('io');
    }));

  it('dọn thùng rác quá hạn ở lần dời kế tiếp', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t, 1);
      await t.write('a.txt', 'a');
      await t.write('b.txt', 'b');
      const first = await fs.trashUntracked(['a.txt']);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const second = await fs.trashUntracked(['b.txt']);
      const left = await readdir(join(t.repo.commonDir, 'thaigit', 'trash'));
      expect(left).toEqual([second]);
      expect(((await rejection(fs.restoreTrash(first))) as AdapterError).code).toBe('not-found');
      // Trash not yet expired: left alone.
      const keep = new NodeRepoFs({ root: t.repo.root, gitDir: t.repo.gitDir, commonDir: t.repo.commonDir });
      await keep.restoreTrash(second).catch(() => undefined);
    }));
});

describe('NodeRepoFs: index tạm của snapshot', () => {
  const fsFor = (t: TestRepo) =>
    new NodeRepoFs({ root: t.repo.root, gitDir: t.repo.gitDir, commonDir: t.repo.commonDir });

  it('tạo <gitDir>/thaigit/ và trả đường dẫn index tạm; reset chỉ xoá index tạm và file khoá của nó', () =>
    withTestRepo(async (t) => {
      const fs = fsFor(t);
      const dir = join(await realpath(t.repo.gitDir), 'thaigit');
      const path = await fs.prepareSnapshotIndex(false);
      expect(path).toBe(join(dir, 'snapshot.index'));
      expect((await stat(dir)).isDirectory()).toBe(true);
      await writeFile(join(dir, 'snapshot.index'), 'i');
      await writeFile(join(dir, 'snapshot.index.lock'), 'l');
      await writeFile(join(dir, 'khac.txt'), 'k');
      await fs.prepareSnapshotIndex(false);
      expect(await fileExists(join(dir, 'snapshot.index'))).toBe(true);
      await fs.prepareSnapshotIndex(true);
      expect(await fileExists(join(dir, 'snapshot.index'))).toBe(false);
      expect(await fileExists(join(dir, 'snapshot.index.lock'))).toBe(false);
      expect(await fileExists(join(dir, 'khac.txt'))).toBe(true);
    }));

  it.skipIf(IS_WINDOWS)('từ chối khi thư mục thaigit là symlink', () =>
    withTestRepo(async (t) => {
      const outside = join(t.root, '..', 'ngoai-snapshot');
      await mkdir(outside);
      await symlink(outside, join(t.repo.gitDir, 'thaigit'));
      const error = await rejection(fsFor(t).prepareSnapshotIndex(true));
      expect((error as AdapterError).code).toBe('out-of-scope');
    }),
  );
});

describe('NodeGitHost', () => {
  it('version, init (nhánh main khi chưa cấu hình init.defaultBranch), tạo thư mục thiếu, init lại không phá repo', async () => {
    await withTempDir(async (dir) => {
      const host = new NodeGitHost(isolatedConfig());
      expect(await host.version()).toMatch(/^git version \d+\.\d+/);
      // Do not name a directory "con": CON is a reserved device name on Windows (git reports Invalid argument).
      const target = join(dir, 'cha', 'chau', 'dự án');
      await host.init(target);
      expect(rawGit(target, ['symbolic-ref', '--short', 'HEAD'])).toBe('main\n');
      await writeFile(join(target, 'a.txt'), 'a');
      await host.init(target);
      expect(await readFile(join(target, 'a.txt'), 'utf8')).toBe('a');
      const repo = await openRepository(target, isolatedConfig());
      expect(repo.name).toBe('dự án');
    });
  });

  it('init tôn trọng init.defaultBranch của người dùng', async () => {
    await withTempDir(async (dir) => {
      const globalConfig = join(dir, 'gitconfig');
      await writeFile(globalConfig, '[init]\n\tdefaultBranch = trunk\n');
      const config = isolatedConfig({ GIT_CONFIG_GLOBAL: globalConfig });
      await new NodeGitHost(config).init(join(dir, 'r'));
      expect(rawGit(join(dir, 'r'), ['symbolic-ref', '--short', 'HEAD'], config)).toBe('trunk\n');
    });
  });

  it('clone repo cục bộ có tiến trình; từ chối URL ext::, fd::, bắt đầu bằng "-"', async () => {
    await withTempDir(async (dir) => {
      const config = isolatedConfig();
      const host = new NodeGitHost(config);
      const origin = join(dir, 'origin');
      await host.init(origin);
      rawGit(origin, ['config', 'user.name', 'T'], config);
      rawGit(origin, ['config', 'user.email', 't@x'], config);
      await writeFile(join(origin, 'a.txt'), 'xin chào\n');
      rawGit(origin, ['add', '.'], config);
      rawGit(origin, ['commit', '-m', 'init'], config);

      const lines: string[] = [];
      const destination = join(dir, 'nhiều', 'cấp', 'bản sao');
      await host.clone(origin, destination, { onProgress: (line) => lines.push(line) });
      expect(await readFile(join(destination, 'a.txt'), 'utf8')).toBe('xin chào\n');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((line) => line.startsWith('Cloning into'))).toBe(true);

      for (const url of [
        'ext::sh -c touch% /tmp/pwned',
        'EXT::sh',
        'fd::17',
        '--upload-pack=touch /tmp/pwned',
        '-u',
        ' https://x',
        '',
      ]) {
        const error = await rejection(host.clone(url, join(dir, 'xau')));
        expect(error, url).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).code).toBe('policy');
      }
      // Cloning from a nonexistent source → GitError carrying git's own message.
      const failure = await rejection(host.clone(join(dir, 'khong-co'), join(dir, 'dich')));
      expect(failure).toBeInstanceOf(GitError);
    });
  });
});

describe.skipIf(IS_WINDOWS)('NodeGitHost: huỷ clone', () => {
  it('huỷ clone đang treo: CancelledError mang mã thoát của git, không để lại thư mục dở hay tiến trình mồ côi', async () => {
    await withTempDir(async (dir) => {
      const hang = await createHangScript(dir, 'hang-ssh');
      const host = new NodeGitHost(isolatedConfig({ GIT_SSH_COMMAND: hang.script }));
      const controller = new AbortController();
      const destination = join(dir, 'dich');
      const pending = host.clone('ssh://localhost/khong-ton-tai.git', destination, {
        signal: controller.signal,
      });
      const sshPid = await hang.pid();
      controller.abort();
      const error = await rejection(pending);
      expect(error).toBeInstanceOf(CancelledError);
      expect((error as CancelledError).exitCode).toBe(143);
      await expect(lstat(destination)).rejects.toThrow();
      await waitFor(() => !isProcessAlive(sshPid), 5000);
    });
  });
});

describe('NodeTypedGit: lệnh có kiểu', () => {
  it('configSet chỉ nhận khoá trong allowlist; giá trị bắt đầu bằng "-" vẫn là giá trị', () =>
    withTestRepo(async (t) => {
      const typed = new NodeTypedGit({ ...t.config, cwd: t.root });
      await typed.configSet('user.name', '-Tên bắt đầu bằng gạch', 'local');
      expect(t.git('config', '--local', 'user.name')).toBe('-Tên bắt đầu bằng gạch\n');
      await typed.configSet('branch.feature/x.y.remote', 'origin', 'local');
      await typed.configSet('pull.rebase', 'true', 'local');
      expect(t.git('config', 'pull.rebase')).toBe('true\n');

      for (const key of [
        'core.fsmonitor',
        'core.sshCommand',
        'alias.x',
        'core.hooksPath',
        'credential.helper',
        'user.name\nx',
        'branch..remote',
        'user.signingkey',
        'url.x.insteadOf',
      ]) {
        const error = await rejection(typed.configSet(key, 'giá trị', 'local'));
        expect(error, key).toBeInstanceOf(AdapterError);
        expect((error as AdapterError).code).toBe('policy');
      }
      expect(((await rejection(typed.configSet('user.name', 'a\0b', 'local'))) as AdapterError).code).toBe(
        'policy',
      );
      // branch.*.remote takes a URL: the policy's URL rules apply.
      expect(
        ((await rejection(typed.configSet('branch.main.remote', 'ext::sh -c id', 'local'))) as AdapterError)
          .code,
      ).toBe('policy');
      expect(isAllowedConfigKey('USER.NAME')).toBe(true);
      expect(isAllowedConfigKey('branch.a.b.merge')).toBe(true);
    }));

  it('configSet phạm vi global ghi vào file GIT_CONFIG_GLOBAL', async () => {
    await withTempDir(async (dir) => {
      const globalConfig = join(dir, 'gitconfig');
      await writeFile(globalConfig, '');
      const config = isolatedConfig({ GIT_CONFIG_GLOBAL: globalConfig });
      const host = new NodeGitHost(config);
      await host.init(join(dir, 'r'));
      const typed = new NodeTypedGit({ ...config, cwd: join(dir, 'r') });
      await typed.configSet('user.email', 'global@example.com', 'global');
      expect(await readFile(globalConfig, 'utf8')).toContain('global@example.com');
    });
  });

  it('remoteAdd / remoteSetUrl kiểm URL và tên remote', () =>
    withTestRepo(async (t) => {
      const typed = new NodeTypedGit({ ...t.config, cwd: t.root });
      await typed.remoteAdd('origin', 'https://github.com/a/b.git');
      expect(t.git('remote', 'get-url', 'origin')).toBe('https://github.com/a/b.git\n');
      await typed.remoteSetUrl('origin', 'git@github.com:a/c.git');
      expect(t.git('remote', 'get-url', 'origin')).toBe('git@github.com:a/c.git\n');
      await typed.remoteAdd('cục-bộ', '/tmp/một thư mục/repo.git');
      expect(t.git('remote', 'get-url', 'cục-bộ')).toBe('/tmp/một thư mục/repo.git\n');

      for (const url of [
        'ext::sh -c id',
        'fd::3',
        'EXT::x',
        '-oProxyCommand=id',
        '',
        ' https://x',
        'https://x\n',
      ]) {
        expect(((await rejection(typed.remoteAdd('moi', url))) as AdapterError).code, url).toBe('policy');
        expect(((await rejection(typed.remoteSetUrl('origin', url))) as AdapterError).code, url).toBe(
          'policy',
        );
      }
      for (const name of ['', '-x', '--upload-pack=x', 'a b', 'a\nb']) {
        expect(((await rejection(typed.remoteAdd(name, 'https://x/y'))) as AdapterError).code, name).toBe(
          'policy',
        );
      }
      expect(t.git('remote').trim().split('\n').sort()).toEqual(['cục-bộ', 'origin']);
      // Remote already exists → git reports its usual error.
      expect(await rejection(typed.remoteAdd('origin', 'https://x/y'))).toBeInstanceOf(GitError);
    }));
});

describe('openRepository / locateRepository', () => {
  it('không phải thư mục / không phải repo / bare repo → RepositoryError đúng loại', async () => {
    await withTempDir(async (dir) => {
      const config = isolatedConfig();
      const file = join(dir, 'tep.txt');
      await writeFile(file, 'x');
      const notRepoDir = join(dir, 'khong-phai-repo');
      await mkdir(notRepoDir);
      const bare = join(dir, 'bare.git');
      rawGit(dir, ['init', '--bare', '-b', 'main', bare], config);

      for (const [path, kind] of [
        [join(dir, 'khong-co'), 'notARepository'],
        [file, 'notARepository'],
        [notRepoDir, 'notARepository'],
        [bare, 'bareRepository'],
      ] as const) {
        const error = await rejection(openRepository(path, config));
        expect(error, path).toBeInstanceOf(RepositoryError);
        expect((error as RepositoryError).kind, path).toBe(kind);
      }
      expect(((await rejection(openRepository(notRepoDir, config))) as RepositoryError).message).toContain(
        'không phải là một Git repository',
      );
    });
  });

  it('mở từ thư mục con trả gốc repo; đường dẫn qua symlink được chuẩn hoá bằng realpath', () =>
    withTestRepo(async (t) => {
      await t.write('src/sâu/x.txt', 'x');
      const fromSub = await locateRepository(join(t.root, 'src', 'sâu'), t.config);
      expect(fromSub).toEqual({
        root: t.root,
        gitDir: join(t.root, '.git'),
        commonDir: join(t.root, '.git'),
      });
      if (!IS_WINDOWS) {
        const alias = join(t.root, '..', 'alias');
        await symlink(t.root, alias);
        const viaLink = await locateRepository(alias, t.config);
        expect(viaLink.root).toBe(t.root);
        const repo = await openRepository(alias, t.config);
        expect(repo.root).toBe(t.root);
        expect(repo.name).toBe('repo');
      }
    }));

  it('worktree liên kết: gitDir riêng, commonDir là .git của repo chính', () =>
    withTestRepo(async (t) => {
      await t.write('a.txt', 'a');
      await t.commitAll('init');
      const linked = join(t.root, '..', 'worktree-phu');
      t.git('worktree', 'add', '-b', 'nhanh-phu', linked);
      const location = await locateRepository(linked, t.config);
      expect(location.commonDir).toBe(join(t.root, '.git'));
      expect(location.gitDir).toBe(join(t.root, '.git', 'worktrees', 'worktree-phu'));
      expect(location.root).toBe(await (await import('node:fs/promises')).realpath(linked));
      const repo = await openRepository(linked, t.config);
      expect((await repo.status()).head).toMatchObject({ kind: 'branch', name: 'nhanh-phu' });
    }));
});
