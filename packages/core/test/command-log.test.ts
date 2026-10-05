import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  CommandLog,
  GitError,
  GitRunner,
  MAX_STDERR_CHARS,
  commandLine,
  redactSecrets,
} from '../src/git/index.ts';
import type { Exec, ExecRequest, ExecResult } from '../src/ports/index.ts';

const enc = new TextEncoder();

describe('redactSecrets', () => {
  it('che scheme://user:pass@ thành scheme://***@', () => {
    expect(redactSecrets('https://user:s3cret@github.com/a/b.git')).toBe('https://***@github.com/a/b.git');
    expect(redactSecrets('fatal: unable to access "http://bob:hunter2@example.com:8080/x"')).toBe(
      'fatal: unable to access "http://***@example.com:8080/x"',
    );
    expect(redactSecrets('ssh://git:phrase@host/repo')).toBe('ssh://***@host/repo');
  });

  it('che cả mật khẩu thô có chứa "@" và userinfo chỉ có token', () => {
    expect(redactSecrets('https://user:p@ss@host/x.git')).toBe('https://***@host/x.git');
    expect(redactSecrets('https://abc123token@github.com/a/b')).toBe('https://***@github.com/a/b');
  });

  it('giữ nguyên tên người dùng SSH và URL không có credential', () => {
    expect(redactSecrets('ssh://git@github.com/a/b.git')).toBe('ssh://git@github.com/a/b.git');
    expect(redactSecrets('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    expect(redactSecrets('https://github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(redactSecrets('https://host/path?email=a@b.c')).toBe('https://host/path?email=a@b.c');
    expect(redactSecrets('fetch origin main --prune')).toBe('fetch origin main --prune');
  });

  it('che token GitHub, GitLab, Slack, AWS', () => {
    // FAKE token, built at run time: leaving a real-looking string in the source would get the push blocked by GitHub's secret scanner.
    const fake = (prefix: string, rest: string): string => prefix + rest;
    const samples = [
      fake('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('gho_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
      fake('github_pat_', '11ABCDEFG0abcdefghijkl_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
      fake('glpat-', 'abcdefghij0123456789'),
      fake('xox', 'b-1234567890-0987654321-AbCdEfGhIjKlMnOpQrStUvWx'),
      fake('xox', 'p-1234567890-0987654321-1122334455-abcdef'),
      fake('AKIA', 'IOSFODNN7EXAMPLE'),
    ];
    for (const token of samples) {
      const redacted = redactSecrets(`push --token ${token} origin; remote: ${token}.`);
      expect(redacted, token).not.toContain(token);
      expect(redacted, token).toBe('push --token *** origin; remote: ***.');
    }
  });

  it('che header Authorization còn sót và token trong userinfo kiểu "x-access-token"', () => {
    expect(redactSecrets('Authorization: Bearer abcdef123456')).toBe('Authorization: ***');
    expect(redactSecrets('authorization: basic dXNlcjpwYXNz')).toBe('authorization: ***');
    expect(redactSecrets('https://x-access-token:ghp_abcdefghijklmnop@github.com/a/b')).toBe(
      'https://***@github.com/a/b',
    );
  });

  it('không che nhầm văn bản thường', () => {
    const text = 'Basic usage: ghp tag xoxo AKIA short; github_pat skip glpat';
    expect(redactSecrets(text)).toBe(text);
  });

  it('thời gian tuyến tính với đầu vào bệnh lý (không quay lui thảm hoạ)', () => {
    const inputs = [
      'a'.repeat(300_000),
      'a.'.repeat(150_000),
      `https://${'a'.repeat(300_000)}`,
      'a://'.repeat(60_000),
      `${'ghp_'.repeat(60_000)}`,
      `Authorization:${' '.repeat(100_000)}`,
      `https://${'u:'.repeat(100_000)}`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      redactSecrets(input);
      expect(performance.now() - start, input.slice(0, 20)).toBeLessThan(500);
    }
  });
});

describe('CommandLog', () => {
  const base = { startedAt: 1000, durationMs: 5, exitCode: 0, cancelled: false };

  it('che credential NGAY LÚC GHI, trong cả đối số lẫn stderr', () => {
    const log = new CommandLog();
    const record = log.record({
      ...base,
      args: ['push', 'https://me:ghp_abcdefghijklmnop@github.com/a/b.git', 'main'],
      stderr:
        "fatal: Authentication failed for 'https://me:hunter2@github.com/a/b.git/'\nremote: token AKIAIOSFODNN7EXAMPLE",
      exitCode: 128,
    });
    const stored = JSON.stringify(log.records);
    for (const secret of ['ghp_abcdefghijklmnop', 'hunter2', 'AKIAIOSFODNN7EXAMPLE', 'me:'])
      expect(stored).not.toContain(secret);
    expect(record.args).toEqual(['push', 'https://***@github.com/a/b.git', 'main']);
    expect(record.stderr).toContain("Authentication failed for 'https://***@github.com/a/b.git/'");
    expect(commandLine(record)).toBe('git push https://***@github.com/a/b.git main');
  });

  it('cắt stderr SAU khi che: token nằm ngang chỗ cắt không lọt ra nửa chừng', () => {
    const log = new CommandLog();
    const token = ['ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''); // fake token, assembled so the scanner misses it
    const stderr = `${'x'.repeat(MAX_STDERR_CHARS - 10)} ${token}`;
    const record = log.record({ ...base, args: ['fetch'], stderr });
    expect(record.stderr).not.toContain('ghp_');
    expect(record.stderr.length).toBeLessThanOrEqual(MAX_STDERR_CHARS);
    expect(record.stderr.endsWith('***')).toBe(true);
  });

  it('giữ tối đa `capacity` dòng gần nhất, id tăng dần, bản ghi bất biến', () => {
    const log = new CommandLog(3);
    for (let i = 0; i < 5; i++) log.record({ ...base, args: [`cmd${i}`], stderr: '' });
    expect(log.records.map((record) => record.args[0])).toEqual(['cmd2', 'cmd3', 'cmd4']);
    expect(log.records.map((record) => record.id)).toEqual([3, 4, 5]);
    const snapshot = log.records;
    log.record({ ...base, args: ['cmd5'], stderr: '' });
    expect(snapshot).toHaveLength(3);
    expect(Object.isFrozen(log.records[0])).toBe(true);
    const single = new CommandLog(1);
    single.record({ ...base, args: ['a'], stderr: '' });
    single.record({ ...base, args: ['b'], stderr: '' });
    expect(single.records.map((record) => record.args[0])).toEqual(['b']);
    expect(() => new CommandLog(0)).toThrow(RangeError);
  });

  it('subscribe nhận bản ghi đã che và có thể huỷ đăng ký; clear xoá sạch', () => {
    const log = new CommandLog();
    const seen: string[] = [];
    const unsubscribe = log.subscribe((record) => seen.push(record.args.join(' ')));
    log.record({ ...base, args: ['clone', 'https://u:p@h/x'], stderr: '' });
    unsubscribe();
    log.record({ ...base, args: ['status'], stderr: '' });
    expect(seen).toEqual(['clone https://***@h/x']);
    log.clear();
    expect(log.records).toEqual([]);
  });
});

describe('GitRunner + CommandLog (Exec giả)', () => {
  function fakeExec(result: Partial<ExecResult> | Error, calls: ExecRequest[] = []): Exec {
    return {
      async run(request) {
        calls.push(request);
        if (result instanceof Error) throw result;
        return { code: 0, stdout: new Uint8Array(0), stderr: new Uint8Array(0), cancelled: false, ...result };
      },
    };
  }

  it('ghi nhật ký đã che kể cả khi lệnh thất bại, và GitError mang mã thoát thật', async () => {
    const log = new CommandLog();
    const exec = fakeExec({
      code: 128,
      stderr: enc.encode("fatal: could not read from 'https://u:pw123@host/r.git'"),
    });
    const runner = new GitRunner(exec, log);
    const error = await runner.run('fetch', ['https://u:pw123@host/r.git']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitError);
    expect((error as GitError).exitCode).toBe(128);
    expect((error as GitError).commandLine).toBe('git fetch https://***@host/r.git');
    expect(JSON.stringify(log.records)).not.toContain('pw123');
    expect(log.records[0]?.exitCode).toBe(128);
  });

  it('huỷ → CancelledError mang mã thoát thật (không che kết quả), nhật ký ghi cancelled', async () => {
    const log = new CommandLog();
    const runner = new GitRunner(fakeExec({ code: 143, cancelled: true }), log);
    const error = await runner.run('fetch', ['--all']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).exitCode).toBe(143);
    expect(log.records[0]).toMatchObject({ exitCode: 143, cancelled: true, args: ['fetch', '--all'] });
  });

  it('acceptExitCodes cho phép mã khác 0; lỗi của bộ chuyển được ghi nhật ký rồi ném lại nguyên vẹn', async () => {
    const log = new CommandLog();
    const ok = await new GitRunner(fakeExec({ code: 1 }), log).run('diff', ['--no-index'], {
      acceptExitCodes: [0, 1],
    });
    expect(ok.code).toBe(1);
    const boom = new Error('lệnh bị chặn');
    await expect(new GitRunner(fakeExec(boom), log).run('status', [])).rejects.toBe(boom);
    expect(log.records.at(-1)).toMatchObject({ exitCode: -1, stderr: 'lệnh bị chặn' });
  });

  it('kind lấy từ chính sách theo subcommand; tham số tuỳ chọn được chuyển nguyên cho Exec', async () => {
    const calls: ExecRequest[] = [];
    const runner = new GitRunner(fakeExec({}, calls));
    const lines: string[] = [];
    const controller = new AbortController();
    await runner.run('status', [], { env: { GIT_OPTIONAL_LOCKS: '0' } });
    await runner.run('commit', ['-F', '-'], { stdin: enc.encode('msg') });
    await runner.run('fetch', ['--progress'], {
      signal: controller.signal,
      profile: 'background',
      onProgress: (line) => lines.push(line),
    });
    expect(calls.map((call) => call.kind)).toEqual(['read', 'write', 'network']);
    expect(calls[0]?.env).toEqual({ GIT_OPTIONAL_LOCKS: '0' });
    expect(calls[2]?.profile).toBe('background');
    expect(calls[2]?.signal).toBe(controller.signal);
    calls[2]?.onStderrLine?.(enc.encode('  Receiving objects:  10% (1/10)  '));
    calls[2]?.onStderrLine?.(enc.encode('   '));
    expect(lines).toEqual(['Receiving objects:  10% (1/10)']);
  });

  it('GitError.message theo luật của Swift', () => {
    expect(new GitError(['x'], 1, '', '  lỗi stderr \n').message).toBe('lỗi stderr');
    expect(new GitError(['x'], 1, 'out', 'err').message).toBe('out\nerr');
    expect(new GitError(['x'], 0, 'out', 'err').message).toBe('err');
    expect(new GitError(['x'], 1, 'o'.repeat(2000), 'err').message).toBe('err');
    expect(new GitError(['x'], 1, 'chỉ stdout', '').message).toBe('chỉ stdout');
    expect(new GitError(['fetch', '--all'], 7, '', '').message).toBe('Lệnh git fetch thất bại (mã thoát 7).');
    expect(new GitError(['x'], 1, '', 'CONFLICT (content)').contains('conflict')).toBe(true);
  });
});
