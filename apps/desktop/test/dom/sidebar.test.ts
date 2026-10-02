// Sidebar dựng bằng Svelte thật trong happy-dom trên RepoStore + repo git thật.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Sidebar from '../../src/lib/sidebar/Sidebar.svelte';
import { openLoaded, setupEdge, until, type LoadedRepo } from '../helpers/edge-repo.ts';
import { fastImportLinear } from '../helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function mountSidebar(repo: LoadedRepo): Promise<HTMLElement> {
  cleanups.push(() => repo.cleanup());
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Sidebar, { target, props: { store: repo.store } });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  return target;
}

/** Các hàng `.sb-row` của mục thứ `index` (0 LOCAL, 1 REMOTE, 2 TAGS, 3 STASHES). */
const rowsOf = (root: HTMLElement, index: number): HTMLElement[] => [
  ...(root.querySelectorAll('section')[index]?.querySelectorAll<HTMLElement>('.sb-row') ?? []),
];
const titles = (rows: HTMLElement[]): string[] =>
  rows.map((row) => row.querySelector('.sb-title')?.textContent?.trim() ?? '');
const click = (element: HTMLElement | undefined): void => {
  element?.click();
  flushSync();
};

describe('Sidebar: stash trùng sha (H2a)', () => {
  it('dựng đủ hai hàng (không ném each_key_duplicate); bấm hàng nào thì chỉ hàng đó sáng', async () => {
    const repo = await openLoaded(setupEdge);
    const root = await mountSidebar(repo);
    const stashes = rowsOf(root, 3);
    expect(stashes).toHaveLength(3);
    const shas = repo.store.stashes.map((stash) => stash.sha);
    expect(shas[0]).toBe(shas[2]);
    expect(shas[1]).not.toBe(shas[0]);

    // Bấm bản trùng (cuối): chỉ hàng đó sáng, hàng cùng sha ở trên cùng thì KHÔNG.
    click(stashes[2]);
    expect(stashes.map((row) => row.classList.contains('selected'))).toEqual([false, false, true]);
    expect(repo.store.selection).toEqual({ kind: 'stash', sha: shas[2] });
    click(stashes[0]);
    expect(stashes.map((row) => row.classList.contains('selected'))).toEqual([true, false, false]);

    // Chọn commit khác trên graph: sidebar bỏ sáng cả hai.
    repo.store.select({ kind: 'commit', sha: repo.store.headOid! });
    flushSync();
    expect(stashes.map((row) => row.classList.contains('selected'))).toEqual([false, false, false]);
  });
});

describe('Sidebar: remote có "/" trong tên (M3)', () => {
  it('nhánh của remote "team/a" hiện dưới đúng remote đó, với tên ngắn đúng; "origin" không bị lẫn', async () => {
    const repo = await openLoaded(setupEdge);
    const root = await mountSidebar(repo);
    const remotes = () => rowsOf(root, 1).filter((row) => row.hasAttribute('aria-expanded'));
    expect(titles(remotes())).toEqual(['origin', 'team/a']);

    click(remotes()[1]);
    // team/a: "feature" (thư mục) rồi "main"; nhánh con của thư mục chỉ hiện khi mở.
    const afterTeam = titles(rowsOf(root, 1));
    expect(afterTeam).toContain('main');
    expect(afterTeam).toContain('feature');
    expect(afterTeam).not.toContain('a');
    expect(afterTeam).not.toContain('a/main');

    click(remotes()[0]);
    const all = titles(rowsOf(root, 1));
    expect(all.filter((title) => title === 'main')).toHaveLength(2);
  });
});

describe('Sidebar: ref trỏ vào commit chưa được tải (L1)', () => {
  it('không sáng ô khi không chọn được commit; có thông báo "Tải thêm"', async () => {
    const repo = await openLoaded(
      (git, root) => {
        fastImportLinear(git, root, 300);
        const first = git('rev-list', '--max-parents=0', 'HEAD').trim();
        git('branch', 'cu-ky', first);
      },
      { commitLimit: 200 },
    );
    const root = await mountSidebar(repo);
    const row = rowsOf(root, 0).find((candidate) => candidate.textContent?.includes('cu-ky'));
    expect(row).toBeDefined();
    click(row);
    expect(row?.classList.contains('selected')).toBe(false);
    expect(repo.store.selection.kind).not.toBe('none');
    expect(repo.toasts.items.map((toast) => toast.actions[0]?.title)).toEqual(['Tải thêm']);

    // Nhánh trỏ vào commit đã tải thì sáng bình thường.
    const main = rowsOf(root, 0).find((candidate) => candidate.textContent?.includes('main'));
    click(main);
    await until(() => main?.classList.contains('selected') === true, 'ô main sáng');
  });
});
