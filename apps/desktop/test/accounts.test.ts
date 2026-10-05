// Tài khoản git và Pull Request: đọc host / owner từ remote, chọn tài khoản theo owner, đăng nhập bằng mã (hỏi theo nhịp
// `interval`, huỷ được), câu lỗi thân thiện, cách checkout PR theo từng loại máy chủ và nhánh dùng khi tạo PR.
import type { AccountsView, ForgeAccount, ForgeMergeRequest } from '@thaigit/contracts';
import { describe, expect, it, vi as spy } from 'vitest';
import { branchesOnRemote, defaultBase, pushedName } from '../src/lib/forge/createPullRequest.svelte.ts';
import { pullRequestCheckout } from '../src/lib/forge/pullRequests.ts';
import { commitWebUrl, forgeTarget, providerOfHost, repoForgeTarget } from '../src/lib/forge/target.ts';
import {
  AccountsStore,
  forgeErrorText,
  type AccountsPort,
  type Timers,
} from '../src/lib/stores/accounts.svelte.ts';
import type { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { vi } from '../src/lib/strings.vi.ts';
import { local, remote } from './helpers/models.ts';

function account(host: string, login: string, organizations: string[] = []): ForgeAccount {
  return {
    host,
    provider: 'github',
    id: '1',
    login,
    displayName: login,
    commitName: login,
    commitEmail: `${login}@example.com`,
    organizations,
    hasToken: true,
  };
}

function view(partial: Partial<AccountsView> = {}): AccountsView {
  return { accounts: [], defaults: {}, ownerAssignments: {}, oauthClientIds: {}, ...partial };
}

function port(overrides: Partial<AccountsPort> = {}): AccountsPort {
  const reject = () => Promise.reject(new Error('không dùng trong test này'));
  return {
    list: () => Promise.resolve(view()),
    addToken: reject,
    startLogin: reject,
    pollLogin: reject,
    cancelLogin: () => Promise.resolve(),
    remove: reject,
    setDefault: reject,
    assignOwner: reject,
    setIdentity: reject,
    setClientId: reject,
    ...overrides,
  };
}

/** Đồng hồ giả: giữ hàm hẹn giờ, test tự gọi `tick()`. */
function manualTimers(): Timers & { tick(): Promise<void>; pending(): number; delays: number[] } {
  let queue: (() => void)[] = [];
  const delays: number[] = [];
  return {
    delays,
    setTimeout(run, ms) {
      queue.push(run);
      delays.push(ms);
      return queue.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout() {
      queue = [];
    },
    async tick() {
      const runs = queue;
      queue = [];
      for (const run of runs) run();
      // Chờ các promise của lần hỏi chạy xong.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
    pending: () => queue.length,
  };
}

const deviceCode = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
  deviceCode: 'dc-1',
};

describe('forgeTarget', () => {
  it('đọc host / owner / repo từ HTTPS, scp, ssh:// và nhóm con của GitLab', () => {
    expect(forgeTarget('https://github.com/HoangThai18/thaigit.git')).toMatchObject({
      host: 'github.com',
      provider: 'github',
      owner: 'HoangThai18',
      repo: 'thaigit',
    });
    expect(forgeTarget('git@gitlab.com:team/app.git')).toMatchObject({
      provider: 'gitlab',
      owner: 'team',
      repo: 'app',
    });
    expect(forgeTarget('ssh://git@gitlab.acme.vn:2222/group/sub/app.git')).toMatchObject({
      host: 'gitlab.acme.vn',
      provider: 'gitlab',
      owner: 'group',
      repo: 'sub/app',
    });
    expect(forgeTarget('https://alice@Bitbucket.org/ws/app')).toMatchObject({
      host: 'bitbucket.org',
      provider: 'bitbucket',
    });
    expect(forgeTarget('https://git.acme.vn/a/b')).toMatchObject({ provider: null });
  });

  it('bỏ qua đường dẫn trên máy, URL thiếu repo và segment lạ', () => {
    for (const url of [
      '/Users/thai/repo',
      'C:\\repo',
      'https://github.com/only',
      'https://github.com/a/../b',
      'git@github.com:a b/c',
      '',
    ]) {
      expect(forgeTarget(url), url).toBeNull();
    }
  });

  it('repo đã mở: ưu tiên origin, kèm tên remote', () => {
    const remotes = [
      { name: 'upstream', fetchUrl: 'https://github.com/acme/app.git' },
      { name: 'origin', fetchUrl: 'git@github.com:alice/app.git' },
    ];
    expect(repoForgeTarget(remotes)).toMatchObject({ remote: 'origin', owner: 'alice' });
    expect(repoForgeTarget([{ name: 'origin', fetchUrl: '/tmp/x' }])).toBeNull();
    expect(repoForgeTarget([])).toBeNull();
  });

  it('đoán provider theo host', () => {
    expect(providerOfHost('GitHub.com')).toBe('github');
    expect(providerOfHost('gitlab.acme.vn')).toBe('gitlab');
    expect(providerOfHost('git.acme.vn')).toBeNull();
  });
});

describe('AccountsStore', () => {
  it('chọn tài khoản cho owner như Rust: gán tay → trùng login → tổ chức → mặc định', () => {
    const store = new AccountsStore(port());
    store.view = view({
      accounts: [account('github.com', 'alice'), account('github.com', 'bob', ['acme'])],
      defaults: { 'github.com': 'alice' },
      ownerAssignments: { 'github.com/corp': 'bob', 'github.com/gone': 'carol' },
    });
    expect(store.loginForOwner('github.com', 'Corp')).toBe('bob');
    expect(store.loginForOwner('github.com', 'BOB')).toBe('bob');
    expect(store.loginForOwner('github.com', 'acme')).toBe('bob');
    expect(store.loginForOwner('github.com', 'someone')).toBe('alice');
    // Gán cho tài khoản đã gỡ thì bỏ qua.
    expect(store.loginForOwner('github.com', 'gone')).toBe('alice');
    expect(store.loginForOwner('gitlab.com', 'acme')).toBeNull();
  });

  it('chỉ gán owner khi app đang chọn tài khoản khác', async () => {
    const assignOwner = spy.fn((host: string, owner: string, login: string | null) =>
      Promise.resolve(
        view({
          accounts: [account(host, 'alice'), account(host, 'bob')],
          ownerAssignments: { [`${host}/${owner}`]: login ?? '' },
        }),
      ),
    );
    const store = new AccountsStore(port({ assignOwner }));
    store.view = view({
      accounts: [account('github.com', 'alice'), account('github.com', 'bob')],
      defaults: { 'github.com': 'alice' },
    });
    await store.ensureOwnerUses('github.com', 'alice', 'alice');
    expect(assignOwner).not.toHaveBeenCalled();
    await store.ensureOwnerUses('github.com', 'acme', 'bob');
    expect(assignOwner).toHaveBeenCalledWith('github.com', 'acme', 'bob');
    expect(store.loginForOwner('github.com', 'acme')).toBe('bob');
  });

  it('đăng nhập bằng mã: hỏi theo interval tới khi có tài khoản rồi nạp lại danh sách', async () => {
    const timers = manualTimers();
    const answers: (string | null)[] = [null, null, 'alice'];
    const pollLogin = spy.fn(() => Promise.resolve(answers.shift() ?? null));
    const list = spy.fn(() => Promise.resolve(view({ accounts: [account('github.com', 'alice')] })));
    const store = new AccountsStore(
      port({ startLogin: () => Promise.resolve(deviceCode), pollLogin, list }),
      timers,
    );
    const done = spy.fn();

    expect(await store.startLogin('github.com', 'github', done)).toBe(true);
    expect(store.login).toMatchObject({ userCode: 'ABCD-1234', deviceCode: 'dc-1' });
    expect(timers.delays[0]).toBe(5000);
    await timers.tick();
    await timers.tick();
    expect(done).not.toHaveBeenCalled();
    await timers.tick();
    expect(pollLogin).toHaveBeenCalledTimes(3);
    expect(done).toHaveBeenCalledWith('alice');
    expect(store.login).toBeNull();
    expect(store.view.accounts).toHaveLength(1);
    expect(timers.pending()).toBe(0);
  });

  it('huỷ đăng nhập: ngừng hỏi và báo Rust bỏ phiên', async () => {
    const timers = manualTimers();
    const cancelLogin = spy.fn(() => Promise.resolve());
    const pollLogin = spy.fn(() => Promise.resolve(null));
    const store = new AccountsStore(
      port({ startLogin: () => Promise.resolve(deviceCode), pollLogin, cancelLogin }),
      timers,
    );
    await store.startLogin('github.com', 'github', () => undefined);
    store.cancelLogin();
    await timers.tick();
    expect(pollLogin).not.toHaveBeenCalled();
    expect(cancelLogin).toHaveBeenCalledWith('dc-1');
    expect(store.login).toBeNull();
  });

  it('lỗi khi hỏi (từ chối / hết hạn) → câu thân thiện, không hỏi tiếp', async () => {
    const timers = manualTimers();
    const store = new AccountsStore(
      port({
        startLogin: () => Promise.resolve(deviceCode),
        pollLogin: () => Promise.reject({ code: 'auth', message: 'Bạn đã từ chối đăng nhập github.com' }),
      }),
      timers,
    );
    await store.startLogin('github.com', 'github', () => undefined);
    await timers.tick();
    expect(store.error).toBe(vi.accounts.errors.auth);
    expect(store.login).toBeNull();
    expect(timers.pending()).toBe(0);
  });

  it('không bắt đầu được (thiếu Client ID…) → false + lỗi, không hẹn giờ', async () => {
    const timers = manualTimers();
    const store = new AccountsStore(
      port({ startLogin: () => Promise.reject({ code: 'auth', message: 'x' }) }),
      timers,
    );
    expect(await store.startLogin('github.com', 'github', () => undefined)).toBe(false);
    expect(store.error).toBe(vi.accounts.errors.auth);
    expect(timers.pending()).toBe(0);
  });
});

describe('forgeErrorText', () => {
  it('chỉ dựa vào mã lỗi, không hiện message gốc', () => {
    const raw = 'reqwest error: tcp connect 140.82.112.3:443';
    expect(forgeErrorText({ code: 'io', message: raw })).toBe(vi.accounts.errors.network);
    expect(forgeErrorText({ code: 'not-found', message: raw })).toBe(vi.accounts.errors.notFound);
    expect(forgeErrorText({ code: 'conflict', message: raw })).toBe(vi.accounts.errors.rejected);
    expect(forgeErrorText(new Error(raw))).toBe(vi.errors.friendly.unexpected);
    for (const code of ['auth', 'busy', 'policy', 'internal']) {
      expect(forgeErrorText({ code, message: raw })).not.toContain('reqwest');
    }
  });
});

function pr(partial: Partial<ForgeMergeRequest>): ForgeMergeRequest {
  return {
    host: 'github.com',
    number: '42',
    title: 'PR',
    body: '',
    author: 'bob',
    sourceBranch: 'feat/x',
    targetBranch: 'main',
    state: 'open',
    draft: false,
    webUrl: 'https://github.com/acme/app/pull/42',
    headHost: 'github.com',
    headOwner: 'acme',
    updatedAt: '',
    commits: null,
    assignees: [],
    reviewers: [],
    ...partial,
  };
}

describe('pullRequestCheckout', () => {
  it('PR cùng repo: fetch nhánh nguồn, nhánh local cùng tên theo dõi remote', () => {
    expect(pullRequestCheckout(pr({}), 'github', 'Acme', 'origin')).toEqual({
      refspec: '+refs/heads/feat/x:refs/remotes/origin/feat/x',
      remoteRef: 'origin/feat/x',
      localName: 'feat/x',
      sameRepo: true,
    });
  });

  it('PR từ fork: ref riêng của GitHub / GitLab, Bitbucket thì không lấy được', () => {
    const fork = pr({ headOwner: 'bob' });
    expect(pullRequestCheckout(fork, 'github', 'acme', 'origin')).toMatchObject({
      refspec: '+refs/pull/42/head:refs/remotes/origin/pr/42',
      localName: 'pr/42',
      sameRepo: false,
    });
    expect(pullRequestCheckout(pr({ headOwner: '' }), 'gitlab', 'acme', 'origin')).toMatchObject({
      refspec: '+refs/merge-requests/42/head:refs/remotes/origin/mr/42',
      localName: 'mr/42',
    });
    expect(pullRequestCheckout(fork, 'bitbucket', 'acme', 'origin')).toBeNull();
    expect(
      pullRequestCheckout(pr({ headOwner: 'bob', number: '4 2' }), 'github', 'acme', 'origin'),
    ).toBeNull();
  });
});

describe('nhánh khi tạo Pull Request', () => {
  function repo(): RepoStore {
    const store = {
      localBranches: [
        local('main', 'a'),
        local('fx', 'b', { upstream: 'origin/feature-x' }),
        local('wip', 'c'),
      ],
      remoteBranches: [
        remote('origin/HEAD', 'a'),
        remote('origin/main', 'a'),
        remote('origin/feature-x', 'b'),
        remote('upstream/dev', 'd'),
      ],
      remotes: [{ name: 'origin' }, { name: 'upstream' }],
      splitUpstream(upstream: string) {
        const match = store.remotes.find((item) => upstream.startsWith(`${item.name}/`));
        return match ? { remote: match.name, branch: upstream.slice(match.name.length + 1) } : null;
      },
    };
    return store as unknown as RepoStore;
  }

  it('nhánh đích lấy từ remote của repo, bỏ HEAD', () => {
    expect(branchesOnRemote(repo(), 'origin')).toEqual(['main', 'feature-x']);
    expect(defaultBase(['feature-x', 'main'])).toBe('main');
    expect(defaultBase(['b', 'a'])).toBe('b');
    expect(defaultBase([])).toBeNull();
  });

  it('nhánh nguồn là tên trên remote (theo upstream); chưa push → null', () => {
    expect(pushedName(repo(), 'origin', 'fx')).toBe('feature-x');
    expect(pushedName(repo(), 'origin', 'main')).toBe('main');
    expect(pushedName(repo(), 'origin', 'wip')).toBeNull();
  });
});

describe('commitWebUrl', () => {
  it('dựng trang commit theo máy chủ, máy chủ lạ / sha lạ thì không', () => {
    const sha = 'a'.repeat(40);
    const url = (remote: string) => {
      const target = forgeTarget(remote);
      return target === null ? null : commitWebUrl(target, sha);
    };
    expect(url('git@github.com:HoangThai18/thaigit.git')).toBe(
      `https://github.com/HoangThai18/thaigit/commit/${sha}`,
    );
    expect(url('https://gitlab.example.com/nhom/con/app.git')).toBe(
      `https://gitlab.example.com/nhom/con/app/-/commit/${sha}`,
    );
    expect(url('https://bitbucket.org/team/app')).toBe(`https://bitbucket.org/team/app/commits/${sha}`);
    expect(url('https://git.example.com/a/b.git')).toBeNull();
    expect(commitWebUrl(forgeTarget('https://github.com/a/b')!, 'HEAD; rm')).toBeNull();
  });
});
