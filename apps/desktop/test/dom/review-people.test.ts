// Gán người review / người được gán trong panel review: ReviewPanel + ReviewPeople dựng bằng Svelte thật trên RepoStore + repo git
// thật, còn "Rust" (IPC) là bản giả ghi lại lệnh và đối số.
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ForgeMergeRequest, ForgePerson } from '@thaigit/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  handler: null as null | ((command: string, args?: unknown) => Promise<unknown>),
  calls: [] as { command: string; args: unknown }[],
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: (command: string, args?: unknown) => {
    hoisted.calls.push({ command, args });
    return hoisted.handler ? hoisted.handler(command, args) : Promise.reject(new Error('chưa có bản giả'));
  },
}));

const { default: ReviewPanel } = await import('../../src/lib/forge/ReviewPanel.svelte');
const { vi: strings } = await import('../../src/lib/strings.vi.ts');
const { stubLayout } = await import('../helpers/dom-layout.ts');
const { openLoaded, setupEdge, until } = await import('../helpers/edge-repo.ts');
type LoadedRepo = Awaited<ReturnType<typeof openLoaded>>;

const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  hoisted.handler = null;
  hoisted.calls = [];
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const person = (username: string, name = '', id: number | null = null): ForgePerson => ({
  username,
  name,
  id,
});

function request(partial: Partial<ForgeMergeRequest> = {}): ForgeMergeRequest {
  return {
    host: 'github.com',
    number: '42',
    title: 'Thêm tính năng',
    body: '',
    author: 'bob',
    sourceBranch: 'feat',
    targetBranch: 'main',
    state: 'open',
    draft: false,
    webUrl: 'https://github.com/acme/app/pull/42',
    headHost: 'github.com',
    headOwner: 'acme',
    updatedAt: '',
    commits: 1,
    assignees: [],
    reviewers: [],
    ...partial,
  };
}

/** Repo có remote origin ở GitHub (chỉ để app nhận ra máy chủ — không có lệnh mạng nào chạy). */
async function mountPanel(
  remote = 'https://github.com/acme/app.git',
): Promise<{ repo: LoadedRepo; root: HTMLElement }> {
  const repo = await openLoaded((git, root) => {
    setupEdge(git, root);
    git('remote', 'set-url', 'origin', remote);
  });
  await until(() => repo.store.remotes.some((item) => item.name === 'origin'), 'remote origin');
  const restore = stubLayout({ width: 360, height: 600 });
  cleanups.push(() => repo.cleanup());
  cleanups.push(restore);
  const root = document.createElement('div');
  document.body.append(root);
  const app = mount(ReviewPanel, { target: root, props: { store: repo.store } });
  cleanups.push(() => {
    unmount(app);
    root.remove();
  });
  return { repo, root };
}

function open(
  repo: LoadedRepo,
  item: ForgeMergeRequest,
  provider: 'github' | 'gitlab' | 'bitbucket' = 'github',
): void {
  const token = repo.store.review.begin(item, provider);
  repo.store.review.finish(token, { head: 'a', from: 'b', files: [] });
  flushSync();
}

const editButton = (root: HTMLElement, index: number): HTMLButtonElement =>
  root.querySelectorAll<HTMLButtonElement>('.people .icon-btn')[index]!;

async function settle(): Promise<void> {
  flushSync();
  await tick();
}

describe('ReviewPeople', () => {
  it('hiện người hiện có (tên + @tên đăng nhập) và "Chưa có ai" khi rỗng; chữ lạ chỉ là text', async () => {
    const { repo, root } = await mountPanel();
    open(repo, request({ reviewers: [person('chi', 'Chi Lê'), person('<b>x</b>')] }));
    await settle();
    const rows = [...root.querySelectorAll('.people')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.label')?.textContent).toBe(strings.pullRequests.reviewers);
    expect(rows[0]!.textContent).toContain('Chi Lê');
    expect(rows[0]!.textContent).toContain('@chi');
    expect(rows[0]!.querySelector('b')).toBeNull();
    expect(rows[0]!.textContent).toContain('<b>x</b>');
    expect(rows[1]!.querySelector('.label')?.textContent).toBe(strings.pullRequests.assignees);
    expect(rows[1]!.textContent).toContain(strings.pullRequests.nobody);
  });

  it('Bitbucket: chỉ hiện người review, không có nút sửa và không có dòng người được gán', async () => {
    const { repo, root } = await mountPanel('https://bitbucket.org/acme/app.git');
    open(repo, request({ host: 'bitbucket.org', reviewers: [person('dung')] }), 'bitbucket');
    await settle();
    expect(root.querySelectorAll('.people')).toHaveLength(1);
    expect(root.querySelectorAll('.people .icon-btn')).toHaveLength(0);
    expect(root.textContent).toContain('dung');
  });

  it('mở bảng chọn: nạp danh sách một lần, bỏ tác giả khỏi người review, lọc theo tên, gửi danh sách mới rồi hiện kết quả của máy chủ', async () => {
    const { repo, root } = await mountPanel();
    const saved = request({ reviewers: [person('an'), person('chi')] });
    hoisted.handler = async (command) => {
      if (command === 'forge_list_assignable')
        return [person('an'), person('bob'), person('chi', 'Chi Lê'), person('dung')];
      if (command === 'forge_set_people') return saved;
      throw new Error(`lệnh lạ ${command}`);
    };
    open(repo, request({ reviewers: [person('an')] }));
    await settle();

    editButton(root, 0).click();
    await until(() => root.querySelectorAll('.choice').length > 0, 'danh sách người');
    // Tác giả (bob) không tự review PR của mình.
    const names = () =>
      [...root.querySelectorAll('.choice')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());
    expect(names()).toEqual(['an', 'Chi Lê @chi', 'dung']);
    const listCalls = hoisted.calls.filter((call) => call.command === 'forge_list_assignable');
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]!.args).toEqual({
      repo: { host: 'github.com', provider: 'github', owner: 'acme', repo: 'app' },
    });

    // Người đang được gán mà không có trong danh sách vẫn hiện (và tick sẵn).
    const checkbox = (row: number) => root.querySelectorAll<HTMLInputElement>('.choice input')[row]!;
    expect(checkbox(0).checked).toBe(true);
    expect(checkbox(1).checked).toBe(false);

    const search = root.querySelector<HTMLInputElement>('.picker .search')!;
    search.value = 'lê';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(names()).toEqual(['Chi Lê @chi']);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const apply = () =>
      [...root.querySelectorAll<HTMLButtonElement>('.picker .btn')].find((b) =>
        b.textContent?.includes(strings.pullRequests.apply),
      )!;
    expect(apply().disabled).toBe(true);
    checkbox(1).click();
    await settle();
    expect(apply().disabled).toBe(false);
    apply().click();
    await until(() => hoisted.calls.some((call) => call.command === 'forge_set_people'), 'gửi danh sách mới');
    const sent = hoisted.calls.find((call) => call.command === 'forge_set_people')!;
    expect(sent.args).toEqual({
      request: {
        host: 'github.com',
        provider: 'github',
        owner: 'acme',
        repo: 'app',
        number: '42',
        role: 'reviewers',
        people: [person('an'), person('chi', 'Chi Lê')],
      },
    });
    await until(
      () => repo.store.review.request?.reviewers.length === 2 && !repo.store.review.saving,
      'nhận kết quả',
    );
    await settle();
    expect(repo.store.review.peopleVersion).toBe(1);
    expect(root.querySelector('.picker')).toBeNull();
    expect(root.querySelectorAll('.people')[0]!.textContent).toContain('chi');
    expect(repo.toasts.items.some((item) => item.title === strings.pullRequests.reviewersSaved)).toBe(true);

    // Mở lại bảng chọn: danh sách người đã nạp, không gọi máy chủ lần nữa.
    editButton(root, 0).click();
    await settle();
    expect(root.querySelectorAll('.choice').length).toBe(3);
    expect(hoisted.calls.filter((call) => call.command === 'forge_list_assignable')).toHaveLength(1);
  });

  it('người được gán: gửi danh sách rỗng khi bỏ hết (GitLab kèm id số)', async () => {
    const { repo, root } = await mountPanel('https://gitlab.com/acme/app.git');
    hoisted.handler = async (command) => {
      if (command === 'forge_list_assignable') return [person('an', 'An', 11), person('binh', 'Bình', 12)];
      return request({ host: 'gitlab.com', assignees: [] });
    };
    open(repo, request({ host: 'gitlab.com', assignees: [person('an', 'An', 11)] }), 'gitlab');
    await settle();
    editButton(root, 1).click();
    await until(() => root.querySelectorAll('.choice').length > 0, 'danh sách người');
    root.querySelectorAll<HTMLInputElement>('.choice input')[0]!.click();
    await settle();
    [...root.querySelectorAll<HTMLButtonElement>('.picker .btn')]
      .find((b) => b.textContent?.includes(strings.pullRequests.apply))!
      .click();
    await until(() => hoisted.calls.some((call) => call.command === 'forge_set_people'), 'gửi');
    const sent = hoisted.calls.find((call) => call.command === 'forge_set_people')!.args as {
      request: Record<string, unknown>;
    };
    expect(sent.request.role).toBe('assignees');
    expect(sent.request.people).toEqual([]);
    expect(sent.request.provider).toBe('gitlab');
    await until(() => !repo.store.review.saving, 'xong');
    expect(repo.toasts.items.some((item) => item.title === strings.pullRequests.assigneesSaved)).toBe(true);
  });

  it('lưu lỗi: toast câu thân thiện (không lộ nội dung lỗi gốc), bảng chọn giữ nguyên để thử lại', async () => {
    const { repo, root } = await mountPanel();
    hoisted.handler = async (command) => {
      if (command === 'forge_list_assignable') return [person('an'), person('chi')];
      throw { code: 'conflict', message: 'GitHub 422: Review cannot be requested from pull request author' };
    };
    open(repo, request());
    await settle();
    editButton(root, 0).click();
    await until(() => root.querySelectorAll('.choice').length > 0, 'danh sách người');
    root.querySelectorAll<HTMLInputElement>('.choice input')[0]!.click();
    await settle();
    [...root.querySelectorAll<HTMLButtonElement>('.picker .btn')]
      .find((b) => b.textContent?.includes(strings.pullRequests.apply))!
      .click();
    await until(
      () => repo.toasts.items.some((item) => item.title === strings.pullRequests.peopleSaveFailed),
      'toast lỗi',
    );
    const shown = repo.toasts.items.map((item) => `${item.title} ${item.message ?? ''}`).join('\n');
    expect(shown).not.toMatch(/422|author|GitHub 4/);
    expect(repo.store.review.saving).toBe(false);
    expect(repo.store.review.peopleVersion).toBe(0);
    await settle();
    expect(root.querySelector('.picker')).not.toBeNull();
  });

  it('nạp danh sách người lỗi: báo lỗi kèm nút thử lại, thử lại được', async () => {
    const { repo, root } = await mountPanel();
    let attempts = 0;
    hoisted.handler = async () => {
      attempts += 1;
      if (attempts === 1) throw { code: 'io', message: 'mất mạng' };
      return [person('an')];
    };
    open(repo, request());
    await settle();
    editButton(root, 0).click();
    await until(() => repo.store.review.peoplePhase === 'failed', 'nạp lỗi');
    await settle();
    expect(root.querySelector('.picker [role="alert"]')?.textContent).toBe(
      strings.pullRequests.peopleLoadFailed,
    );
    [...root.querySelectorAll<HTMLButtonElement>('.picker .btn')]
      .find((b) => b.textContent?.includes(strings.pullRequests.reviewRetry))!
      .click();
    await until(() => root.querySelectorAll('.choice').length === 1, 'thử lại thành công');
    expect(attempts).toBe(2);
  });
});
