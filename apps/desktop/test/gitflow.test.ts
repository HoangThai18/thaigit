import { afterEach, describe, expect, it } from 'vitest';
import { finishFlow, loadGitFlow, setupGitFlow, startFlow } from '../src/lib/gitflow/actions.ts';
import {
  defaultGitFlow,
  finishTag,
  finishTargets,
  flowBranchOf,
  readGitFlow,
  setupProblem,
  type GitFlowConfig,
} from '../src/lib/gitflow/model.ts';
import { DialogStore, type FormValues } from '../src/lib/stores/dialogs.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { openTestPort } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const CONFIG: GitFlowConfig = {
  master: 'main',
  develop: 'develop',
  prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' },
  versionTag: 'v',
};

describe('mô hình Git-flow', () => {
  it('đọc cấu hình git-flow có sẵn, thiếu nhánh chính / develop thì coi như chưa khởi tạo', () => {
    const entries = new Map([
      ['gitflow.branch.master', 'main'],
      ['gitflow.branch.develop', 'dev'],
      ['gitflow.prefix.feature', 'feat/'],
      ['gitflow.prefix.versiontag', 'v'],
    ]);
    expect(readGitFlow(entries)).toEqual({
      master: 'main',
      develop: 'dev',
      prefixes: { feature: 'feat/', release: 'release/', hotfix: 'hotfix/' },
      versionTag: 'v',
    });
    expect(readGitFlow(new Map([['gitflow.branch.master', 'main']]))).toBeNull();
    expect(defaultGitFlow(['master', 'x']).master).toBe('master');
    expect(defaultGitFlow([]).master).toBe('main');
  });

  it('nhận ra nhánh feature / release / hotfix, đích merge và tag', () => {
    expect(flowBranchOf(CONFIG, 'feature/login')).toEqual({
      kind: 'feature',
      name: 'login',
      branch: 'feature/login',
    });
    expect(flowBranchOf(CONFIG, 'feature/')).toBeNull();
    expect(flowBranchOf(CONFIG, 'main')).toBeNull();
    const release = flowBranchOf(CONFIG, 'release/1.2.0')!;
    expect(finishTargets(CONFIG, release.kind)).toEqual(['main', 'develop']);
    expect(finishTag(CONFIG, release)).toBe('v1.2.0');
    expect(finishTargets(CONFIG, 'feature')).toEqual(['develop']);
    expect(finishTag(CONFIG, flowBranchOf(CONFIG, 'feature/x')!)).toBeNull();
  });

  it('kiểm tra cài đặt: tên nhánh hợp lệ, hai nhánh khác nhau, tiền tố không trùng', () => {
    expect(setupProblem(CONFIG)).toBeNull();
    expect(setupProblem({ ...CONFIG, develop: 'main' })).toBe('same');
    expect(setupProblem({ ...CONFIG, master: 'a..b' })).toBe('branch');
    expect(setupProblem({ ...CONFIG, prefixes: { ...CONFIG.prefixes, release: 'feature/' } })).toBe('prefix');
    expect(setupProblem({ ...CONFIG, prefixes: { ...CONFIG.prefixes, hotfix: '' } })).toBe('prefix');
  });
});

describe('Git-flow trên repo thật', () => {
  async function openStore() {
    const test = await openTestPort((git) => {
      git('commit', '-q', '--allow-empty', '-m', 'đầu tiên');
    });
    cleanups.push(() => test.cleanup());
    const dialogs = new DialogStore();
    const store = new RepoStore(test.port, {
      prefs: new PrefsStore(null),
      toasts: new ToastStore(),
      detailsDelayMs: 0,
      clipboard: async () => {},
    });
    cleanups.push(() => store.dispose());
    await store.start();
    await until(() => store.hasLoaded, 'nạp xong');
    return { store, dialogs, test };
  }

  async function answer(dialogs: DialogStore, run: Promise<void>, values: FormValues): Promise<void> {
    await until(() => dialogs.current !== null, 'hộp thoại');
    dialogs.submit(values);
    await run;
  }

  it('khởi tạo, bắt đầu và hoàn tất feature rồi release (merge --no-ff, gắn tag, xoá nhánh)', async () => {
    const { store, dialogs, test } = await openStore();

    await answer(dialogs, setupGitFlow(store, dialogs), {
      master: 'main',
      develop: 'develop',
      feature: 'feature/',
      release: 'release/',
      hotfix: 'hotfix/',
      versionTag: 'v',
    });
    await store.refreshAndWait(7);
    expect(store.localBranches.map((ref) => ref.fullName)).toContain('refs/heads/develop');
    const config = await loadGitFlow(store);
    expect(config).toEqual(CONFIG);

    await answer(dialogs, startFlow(store, config!, 'feature', dialogs), { name: 'login' });
    await store.refreshAndWait(7);
    expect(store.currentBranch).toBe('feature/login');
    test.git('commit', '-q', '--allow-empty', '-m', 'đăng nhập');
    await store.refreshAndWait(7);

    await answer(dialogs, finishFlow(store, config!, 'feature/login', dialogs), { delete: true });
    await store.refreshAndWait(7);
    expect(store.currentBranch).toBe('develop');
    expect(store.localBranches.some((ref) => ref.fullName === 'refs/heads/feature/login')).toBe(false);
    expect(test.git('log', '--merges', '--format=%s', 'develop').trim()).toContain('feature/login');

    await answer(dialogs, startFlow(store, config!, 'release', dialogs), { name: '1.0.0' });
    await store.refreshAndWait(7);
    test.git('commit', '-q', '--allow-empty', '-m', 'chuẩn bị 1.0.0');
    await store.refreshAndWait(7);
    await answer(dialogs, finishFlow(store, config!, 'release/1.0.0', dialogs), { delete: true });
    await store.refreshAndWait(7);
    expect(store.currentBranch).toBe('develop');
    expect(test.git('tag', '--list').trim()).toBe('v1.0.0');
    expect(test.git('log', '--merges', '--format=%s', 'main').trim()).toContain('release/1.0.0');
    expect(test.git('log', '--merges', '--format=%s', 'develop').trim()).toContain('release/1.0.0');
  });

  it('không hoàn tất khi còn thay đổi chưa commit', async () => {
    const { store, dialogs, test } = await openStore();
    test.git('branch', 'develop');
    test.git('switch', '-q', '-c', 'feature/x');
    await test.write('a.txt', 'dở dang');
    await store.refreshAndWait(7);
    await finishFlow(store, CONFIG, 'feature/x', dialogs);
    expect(dialogs.current).toBeNull();
    expect(store.currentBranch).toBe('feature/x');
  });
});
