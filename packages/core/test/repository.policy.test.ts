// Every public GitRepository operation must pass the policy validator (git-policy.json) without being wrongly blocked,
// and its lock `kind` must match the policy. Uses a fake Exec that records commands → no real git, fast, and it
// doubles as the command list for the phase-4a Rust harness, which must accept exactly these commands.

import { validateGitCommand } from '@thaigit/contracts';
import vectors from '@thaigit/contracts/git-policy.vectors.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { GitRepository, execKindOf } from '../src/git/index.ts';
import type { Exec, ExecRequest, RepoFs, TypedGit } from '../src/ports/index.ts';

const enc = new TextEncoder();

class RecordingExec implements Exec {
  readonly requests: ExecRequest[] = [];

  async run(request: ExecRequest) {
    this.requests.push(request);
    const key = `${request.sub} ${request.args.join(' ')}`;
    let stdout = '';
    if (key.startsWith('rev-parse --symbolic-full-name')) stdout = 'refs/remotes/origin/main\n';
    else if (request.sub === 'stash' && request.args[0] === 'create') stdout = 'abc1234\n';
    else if (request.sub === 'hash-object') stdout = 'deadbeef\n';
    else if (request.sub === 'config') stdout = 'giá trị\n';
    return { code: 0, stdout: enc.encode(stdout), stderr: new Uint8Array(0), cancelled: false };
  }
}

const fakeFs: RepoFs = {
  readGitFile: async () => null,
  readWorktreeFile: async () => null,
  writeWorktreeFile: async () => undefined,
  appendGitignore: async () => undefined,
  trashUntracked: async () => 'token',
  restoreTrash: async () => undefined,
  prepareSnapshotIndex: async () => '/repo/.git/thaigit/snapshot.index',
};
const typedCalls: string[] = [];
const fakeTyped: TypedGit = {
  configSet: async (key) => void typedCalls.push(`configSet ${key}`),
  remoteAdd: async (name) => void typedCalls.push(`remoteAdd ${name}`),
  remoteSetUrl: async (name) => void typedCalls.push(`remoteSetUrl ${name}`),
  worktreeAdd: async (token, name) => {
    typedCalls.push(`worktreeAdd ${name}`);
    return `${token}/${name}`;
  },
  rebaseInteractive: async (onto) => {
    typedCalls.push(`rebaseInteractive ${onto}`);
    return { exitCode: 0, stdout: '', stderr: '' };
  },
};

const SHA = 'a'.repeat(40);
const FILE = { path: 'thư mục/tệp có dấu cách.txt', kind: 'modified' } as const;
const RENAMED = { path: 'mới.txt', oldPath: 'cũ.txt', kind: 'renamed' } as const;
const STASH = {
  index: 0,
  selector: 'stash@{0}',
  sha: SHA,
  parents: [SHA, SHA, SHA],
  date: 0,
  message: 'On main: x',
} as const;
const COMMIT = {
  id: SHA,
  parents: [SHA],
  authorName: 'A',
  authorEmail: 'a@x',
  authorDate: 0,
  committerName: 'A',
  committerEmail: 'a@x',
  commitDate: 0,
  subject: 's',
} as const;

describe('GitRepository: mọi thao tác qua được validator chính sách', () => {
  it('không lệnh nào bị chặn nhầm, kind khớp chính sách, và đã gọi hết các phương thức công khai', async () => {
    const exec = new RecordingExec();
    const repo = new GitRepository({
      exec,
      fs: fakeFs,
      root: '/r',
      gitDir: '/r/.git',
      commonDir: '/r/.git',
      typed: fakeTyped,
    });
    const called = new Set<string>();
    const r = new Proxy(repo, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof property === 'string' && typeof value === 'function') {
          called.add(property);
          return value.bind(target);
        }
        return value;
      },
    });
    const network = { onProgress: () => undefined, profile: 'background' as const };

    await r.refs();
    await r.status();
    await r.stashes();
    await r.remotes();
    await r.logBytes({ limit: 2000, order: 'topo', includeHead: true });
    await r.logBytes({
      limit: 10,
      order: 'date',
      includeHead: false,
      includeRemotes: false,
      includeTags: false,
    });
    await r.log({ limit: 5, order: 'date', includeHead: true });
    await r.commitMessage(SHA);
    await r.commitPatch(SHA);
    await r.changedFiles(SHA, SHA);
    await r.changedFiles(SHA, null);
    await r.commitDetails(COMMIT);
    await r.commitDiffBytes(SHA, SHA, RENAMED, 10);
    await r.commitDiffBytes(SHA, null, FILE);
    await r.workingDiffBytes(FILE, 'unstaged');
    await r.workingDiffBytes(FILE, 'staged', 3, true);
    await r.commitDiffBytes(SHA, SHA, FILE, 3, true);
    await r.workingDiffBytes(RENAMED, 'staged', 0);
    await r.workingDiffBytes(FILE, 'untracked');
    await r.stagedDiffBytes();
    await r.commitPatchBytes(SHA, SHA);
    await r.commitPatchBytes(SHA, null, 0);
    await r.branchDiffBytes('main', 'feature/x');
    await r.recentSubjects(10);
    await r.recentSubjects(10, 'feature/x', 'main');
    await r.blob(`HEAD:${FILE.path}`);
    await r.blob(`:${FILE.path}`);
    await r.workingFileBytes(FILE.path);
    await r.fileHistory('-bắt đầu bằng gạch.txt', 50);
    await r.blame('-bắt đầu bằng gạch.txt');
    await r.blame(FILE.path, SHA);
    await r.resolveCommit('HEAD~1');
    await r.config('user.name');
    await r.setConfig('user.name', 'Tên', 'global');
    await r.isValidRefName('feature/x', true);
    await r.isValidRefName('v1.0', false);
    await r.operationState();
    await r.pendingCommitMessage();
    await r.stage([FILE.path, '-lạ.txt']);
    await r.stageAll();
    await r.unstage([FILE.path], true);
    await r.unstage([FILE.path], false);
    await r.unstageAll(true);
    await r.unstageAll(false);
    await r.discard([FILE.path]);
    await r.trashUntracked([FILE.path]);
    await r.restoreTrash('token');
    await r.snapshotChanges();
    await r.restoreWorkingFiles(SHA, [FILE.path]);
    await r.hashObject(enc.encode('x'));
    for (const cached of [true, false])
      for (const reverse of [true, false])
        for (const unidiffZero of [true, false])
          await r.applyPatch(enc.encode('patch'), { cached, reverse, unidiffZero });
    await r.hardReset();
    await r.hardReset(SHA);
    await r.addToGitignore('*.log');
    await r.commit('Tiêu đề\n\nThân -c core.fsmonitor=evil --upload-pack=x', {
      amend: true,
      allowEmpty: true,
    });
    await r.commit('đơn giản');
    await r.softReset('HEAD~1');
    await r.undoInitialCommit();
    await r.switchTo('main');
    await r.switchDetached(SHA);
    await r.createBranch('nhánh/mới', null, true);
    await r.createBranch('nhánh/mới', SHA, false);
    await r.checkoutTracking('origin/x', 'x');
    await r.deleteBranch('x', true);
    await r.deleteBranch('x', false);
    await r.renameBranch('a', 'b');
    await r.setUpstream('main', 'origin/main');
    await r.unsetUpstream('main');
    await r.updateRef('refs/tags/v1', SHA);
    await r.fastForward('main', 'origin/main');
    for (const style of ['automatic', 'noFastForward', 'fastForwardOnly', 'squash'] as const)
      await r.merge('feature', style);
    await r.worktrees();
    await r.addWorktree('token', 'repo-x', 'nhánh/x', true, 'main');
    await r.addWorktree('token', 'repo-y', 'main', false);
    await r.removeWorktree('/tmp/repo-x', true);
    await r.removeWorktree('/tmp/repo-x', false);
    await r.pruneWorktrees();
    await r.submodules();
    await r.updateSubmodules(null);
    await r.updateSubmodules(['vendor/thư viện', '-lạ']);
    await r.syncSubmodules();
    await r.lfsVersion();
    await r.lfsPatterns();
    await r.lfsTrack('*.psd');
    await r.lfsTrack('thư mục/có cách *.bin');
    await r.lfsUntrack('*.psd');
    await r.lfsFetch(false);
    await r.lfsFetch(true);
    await r.lfsPush('origin', 'main');
    await r.lfsPrune();
    await r.rebaseCommits(SHA);
    await r.interactiveRebase(SHA, [
      { commit: COMMIT, action: 'pick' },
      { commit: { ...COMMIT, id: 'b'.repeat(40) }, action: 'reword', message: 'mới' },
    ]);
    await r.rebase('origin/main');
    await r.rebase('origin/main', 'feature');
    await r.cherryPick(SHA);
    await r.cherryPick(SHA, 2);
    await r.revert(SHA);
    await r.revert(SHA, 1);
    for (const mode of ['soft', 'mixed', 'hard'] as const) await r.reset(SHA, mode);
    await r.resetKeepingLocalChanges(SHA);
    const operations = [
      { kind: 'merging' },
      { kind: 'rebasing', step: 1, total: 2, headName: 'main' },
      { kind: 'cherryPicking' },
      { kind: 'reverting' },
      { kind: 'applyingPatches' },
      { kind: 'bisecting' },
    ] as const;
    for (const operation of operations) {
      await r.abort(operation);
      await r.continueOperation(operation);
      await r.skip(operation);
    }
    for (const kind of ['bothModified', 'deletedByUs', 'addedByThem', 'bothDeleted', 'unknown'] as const) {
      await r.resolveConflict(FILE.path, kind, true);
      await r.resolveConflict(FILE.path, kind, false);
    }
    await r.markResolved([FILE.path]);
    await r.readWorkingFile(FILE.path);
    await r.writeWorkingFile(FILE.path, enc.encode('x'), null);
    await r.fetch();
    await r.fetch({ remote: 'origin', prune: true, ...network });
    await r.historyGaps();
    await r.trackAllBranches('origin');
    await r.unshallow('origin', network);
    await r.fetchRefspec('origin', '+refs/pull/42/head:refs/remotes/origin/pr/42', network);
    await r.fetchRefspec(
      'origin',
      ['+refs/pull/42/head:refs/remotes/origin/pr/42', '+refs/heads/main:refs/remotes/origin/main'],
      network,
    );
    await r.mergeBase('origin/main', 'origin/pr/42');
    for (const mode of ['merge', 'rebase', 'fastForwardOnly'] as const) await r.pull(mode, network);
    await r.push({
      remote: 'origin',
      localBranch: 'a',
      remoteBranch: 'b',
      setUpstream: true,
      force: true,
      ...network,
    });
    await r.push({ remote: 'origin', localBranch: 'a/b', remoteBranch: 'a/b' });
    await r.pushCommit(SHA, 'origin', 'khôi-phục', network);
    await r.deleteRemoteBranch('origin', 'x', network);
    await r.pushTag('origin', 'v1', network);
    await r.pushAllTags('origin', network);
    await r.deleteRemoteTag('origin', 'v1', network);
    await r.addRemote('up', 'https://example.com/a.git');
    await r.setRemoteUrl('up', 'https://example.com/b.git');
    await r.renameRemote('up', 'nguồn/mới');
    await r.removeRemote('up');
    await r.stashPush(null, false);
    await r.stashPush('Đang làm dở -u', true);
    await r.stashApply('stash@{0}');
    await r.stashApply('stash@{1}', true);
    await r.stashPop('stash@{0}');
    await r.stashDrop('stash@{0}');
    await r.stashStore(SHA, 'On main: -tin nhắn bắt đầu bằng gạch');
    await r.stashFiles(STASH);
    await r.stashDiffBytes(STASH, { path: 'u.txt', kind: 'untracked' });
    await r.stashDiffBytes(STASH, FILE);
    await r.createTag('v1', SHA, 'chú thích -x');
    await r.createTag('v1-nhe', 'HEAD', null);
    await r.deleteTag('v1');

    const violations = exec.requests.flatMap((request) => {
      const violation = validateGitCommand(request.sub, request.args, request.env ?? {});
      return violation ? [`${request.sub} ${request.args.join(' ')} → ${violation.code}`] : [];
    });
    expect(violations).toEqual([]);
    for (const request of exec.requests) {
      expect(request.kind, `${request.sub} ${request.args.join(' ')}`).toBe(
        execKindOf(request.sub, request.args),
      );
      // Every command runs inside exactly the opened repo: no argument selects a different directory or config.
      expect(
        request.args.some(
          (arg) => arg === '-C' || arg.startsWith('--git-dir') || arg.startsWith('--work-tree'),
        ),
      ).toBe(false);
    }
    expect(exec.requests.length).toBeGreaterThan(130);
    expect(typedCalls).toEqual([
      'configSet user.name',
      'worktreeAdd repo-x',
      'worktreeAdd repo-y',
      `rebaseInteractive ${SHA}`,
      'remoteAdd up',
      'remoteSetUrl up',
    ]);

    const publicMethods = Object.getOwnPropertyNames(GitRepository.prototype).filter(
      (name) =>
        name !== 'constructor' && name !== 'name' && name !== 'mainlineArgs' && name !== 'requireTyped',
    );
    expect(publicMethods.filter((name) => !called.has(name))).toEqual([]);
    expect(publicMethods.length).toBeGreaterThanOrEqual(75);
  });

  it('kind theo dạng lệnh: stash list / remote -v là read (không khoá độc quyền), dạng ghi giữ nguyên', async () => {
    const exec = new RecordingExec();
    const repo = new GitRepository({ exec, fs: fakeFs, root: '/r', gitDir: '/r/.git', commonDir: '/r/.git' });
    await repo.stashes();
    await repo.remotes();
    await repo.stashPop('stash@{0}');
    await repo.removeRemote('x');
    await repo.status();
    await repo.commit('m');
    expect(exec.requests.map((request) => [request.sub, request.args[0] ?? '', request.kind])).toEqual([
      ['stash', 'list', 'read'],
      ['remote', '-v', 'read'],
      ['stash', 'pop', 'write'],
      ['remote', 'remove', 'write'],
      ['status', '--porcelain=v2', 'read'],
      ['commit', expect.any(String), 'write'],
    ]);
  });

  it('execKindOf: chỉ các dạng đã khai báo mới được coi là read; lệnh mạng và lạ không đổi', () => {
    expect(execKindOf('stash')).toBe('write');
    expect(execKindOf('stash', ['list'])).toBe('read');
    expect(execKindOf('stash', ['show', 'stash@{0}'])).toBe('read');
    expect(execKindOf('stash', ['drop'])).toBe('write');
    expect(execKindOf('stash', [])).toBe('write');
    expect(execKindOf('remote', [])).toBe('read');
    expect(execKindOf('remote', ['-v'])).toBe('read');
    expect(execKindOf('remote', ['get-url', 'origin'])).toBe('read');
    expect(execKindOf('remote', ['prune', 'origin'])).toBe('write');
    expect(execKindOf('remote', ['set-url'])).toBe('write');
    // Matching considers the WHOLE args shape: a different subcommand after `-v` is not a read-only form, and `remote show` talks to the server.
    expect(execKindOf('remote', ['--verbose'])).toBe('read');
    expect(execKindOf('remote', ['-v', 'update'])).toBe('write');
    expect(execKindOf('remote', ['-v', 'add', 'x', 'https://example.com/x.git'])).toBe('write');
    expect(execKindOf('remote', ['--verbose', 'prune', 'origin'])).toBe('write');
    expect(execKindOf('remote', ['show', 'origin'])).toBe('write');
    expect(execKindOf('remote', [''])).toBe('write');
    expect(execKindOf('log')).toBe('read');
    expect(execKindOf('fetch', ['--all'])).toBe('network');
    expect(execKindOf('commit', ['list'])).toBe('write');
    expect(execKindOf('không-có')).toBe('write');
    expect(execKindOf('__proto__', ['list'])).toBe('write');
  });

  it('execKindOf khớp mọi ca `kinds` dùng chung với Rust (git-policy.vectors.json)', () => {
    const { kinds } = vectors as unknown as { kinds: { sub: string; args: string[]; kind: string | null }[] };
    expect(kinds.length).toBeGreaterThan(30);
    for (const vector of kinds) {
      // Unknown → `write` (the tightest lock); every other case matches the `kind` column of the case.
      expect(execKindOf(vector.sub, vector.args), `${vector.sub} ${JSON.stringify(vector.args)}`).toBe(
        vector.kind ?? 'write',
      );
    }
  });

  it('stdin và env đúng chỗ: message qua stdin, đường dẫn qua NUL, GIT_OPTIONAL_LOCKS cho status/diff', async () => {
    const exec = new RecordingExec();
    const repo = new GitRepository({ exec, fs: fakeFs, root: '/r', gitDir: '/r/.git', commonDir: '/r/.git' });
    await repo.status();
    await repo.commit('xin chào');
    await repo.stage(['a b.txt', 'c.txt']);
    await repo.workingDiffBytes(FILE, 'unstaged');
    await repo.applyPatch(enc.encode('PATCH'), { cached: true, reverse: false, unidiffZero: true });
    const byKey = (sub: string) => exec.requests.find((request) => request.sub === sub);
    expect(byKey('status')?.env).toEqual({ GIT_OPTIONAL_LOCKS: '0' });
    expect(new TextDecoder().decode(byKey('commit')?.stdin)).toBe('xin chào');
    expect(byKey('commit')?.args).not.toContain('xin chào');
    expect(Array.from(byKey('add')?.stdin ?? [])).toEqual(Array.from(enc.encode('a b.txt\0c.txt\0')));
    expect(byKey('add')?.env).toEqual({ GIT_LITERAL_PATHSPECS: '1' });
    expect(byKey('diff')?.env).toEqual({ GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' });
    expect(new TextDecoder().decode(byKey('apply')?.stdin)).toBe('PATCH');
    expect(byKey('apply')?.args).toEqual([
      '--whitespace=nowarn',
      '--recount',
      '--unidiff-zero',
      '--cached',
      '-',
    ]);
  });
});
