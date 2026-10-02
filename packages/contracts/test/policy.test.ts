import { describe, expect, it } from 'vitest';
import vectors from '../git-policy.vectors.json' with { type: 'json' };
import {
  buildGitArgv,
  buildGitEnv,
  effectiveKind,
  gitPolicy,
  matchesReadForm,
  validateGitCommand,
  type ExecKind,
} from '../src/policy.ts';

interface VectorCase {
  sub: string;
  args: string[];
  env?: Record<string, string>;
  reject: string | null;
}

interface KindCase {
  sub: string;
  args: string[];
  kind: ExecKind | null;
}

describe('validateGitCommand (ca dùng chung với Rust)', () => {
  for (const vector of vectors.cases as VectorCase[]) {
    const label = `${vector.sub} ${vector.args.join(' ')}${vector.env ? ` env=${JSON.stringify(vector.env)}` : ''}`;
    it(`${vector.reject ?? 'cho phép'}: ${label}`, () => {
      const result = validateGitCommand(vector.sub, vector.args, vector.env ?? {});
      expect(result?.code ?? null).toBe(vector.reject);
    });
  }
});

describe('effectiveKind (ca dùng chung với Rust: khớp theo TOÀN BỘ hình dạng args)', () => {
  for (const vector of (vectors as unknown as { kinds: KindCase[] }).kinds) {
    it(`${vector.kind ?? 'không có trong chính sách'}: ${vector.sub} ${JSON.stringify(vector.args)}`, () => {
      expect(effectiveKind(vector.sub, vector.args) ?? null).toBe(vector.kind);
    });
  }

  it('dạng chỉ-đọc chỉ áp dụng cho subcommand `write`; thiếu args thì chỉ xét subcommand', () => {
    expect(effectiveKind('stash')).toBe('write');
    expect(effectiveKind('remote')).toBe('read');
    expect(effectiveKind('log')).toBe('read');
    expect(matchesReadForm(gitPolicy.subcommands.log!, ['list'])).toBe(false);
    expect(matchesReadForm(gitPolicy.subcommands.remote!, ['get-url', 'a', 'b'])).toBe(true);
    expect(matchesReadForm(gitPolicy.subcommands.remote!, ['-v', 'x'])).toBe(false);
  });

  it('mọi ca `read` của subcommand `write` cũng được validator cho phép (khỏi khai báo một dạng mà lệnh bị chặn)', () => {
    for (const vector of (vectors as unknown as { kinds: KindCase[] }).kinds) {
      if (vector.kind !== 'read' || gitPolicy.subcommands[vector.sub]?.kind !== 'write') continue;
      expect(validateGitCommand(vector.sub, vector.args)).toBeNull();
    }
  });
});

describe('buildGitArgv', () => {
  it('chèn cờ -c trước subcommand, kể cả core.fsmonitor=false', () => {
    const argv = buildGitArgv('status', ['--porcelain=v2']);
    expect(argv.slice(0, 2)).toEqual(['-c', 'core.quotepath=false']);
    expect(argv).toContain('core.fsmonitor=false');
    expect(argv.slice(-2)).toEqual(['status', '--porcelain=v2']);
  });

  it('lệnh sinh diff luôn có --no-ext-diff --no-textconv (stash show: sau "show")', () => {
    expect(buildGitArgv('diff', ['--cached']).slice(-4)).toEqual([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--cached',
    ]);
    expect(buildGitArgv('stash', ['show', '-p']).slice(-5)).toEqual([
      'stash',
      'show',
      '--no-ext-diff',
      '--no-textconv',
      '-p',
    ]);
    expect(buildGitArgv('stash', ['push'])).not.toContain('--no-ext-diff');
  });
});

describe('buildGitEnv', () => {
  it('port y nguyên Swift: bỏ LC_ALL, ép thông báo tiếng Anh, bỏ biến làm sai ngữ cảnh repo', () => {
    const env = buildGitEnv(
      {
        PATH: '/usr/bin',
        LC_ALL: 'vi_VN.UTF-8',
        GIT_DIR: '/tmp/x',
        GIT_CONFIG_KEY_0: 'core.pager',
        HOME: '/Users/a',
      },
      { profile: 'background', askpassDeny: '/app --askpass-deny' },
    );
    expect(env.LC_ALL).toBeUndefined();
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.LANGUAGE).toBe('en');
    expect(env.LC_MESSAGES).toBe('C');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
    expect(env.GIT_ASKPASS).toBe('/app --askpass-deny');
    expect(env.HOME).toBe('/Users/a');
  });

  it('chính sách có đủ 11 cờ -c toàn cục', () => {
    expect(gitPolicy.globalConfig).toHaveLength(11);
  });
});
