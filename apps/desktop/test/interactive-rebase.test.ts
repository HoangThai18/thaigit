import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitMenu } from '../src/lib/actions/menus.ts';
import { beginInteractiveRebase, runInteractiveRebase } from '../src/lib/rebase/actions.ts';
import { RebaseSession, rebaseEditor } from '../src/lib/rebase/rebaseEditor.svelte.ts';
import { isMenuAction } from '../src/lib/stores/menus.svelte.ts';
import { PrefsStore } from '../src/lib/stores/prefs.svelte.ts';
import { RepoStore } from '../src/lib/stores/repo.svelte.ts';
import { ToastStore } from '../src/lib/stores/toasts.svelte.ts';
import { vi as strings } from '../src/lib/strings.vi.ts';
import { commit as fakeCommit } from './helpers/models.ts';
import { openTestPort, rawGit } from './helpers/node-port.ts';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  rebaseEditor.close();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** gốc → một → hai → ba, mỗi commit một file. */
async function openStore(setup?: (git: (...args: string[]) => string, root: string) => void) {
  const test = await openTestPort(
    setup ??
      ((git, root) => {
        for (const name of ['gốc', 'một', 'hai', 'ba']) {
          writeFileSync(join(root, `${name}.txt`), `${name}\n`);
          git('add', '.');
          git('commit', '-q', '-m', name);
        }
      }),
  );
  cleanups.push(() => test.cleanup());
  const toasts = new ToastStore();
  const store = new RepoStore(test.port, {
    prefs: new PrefsStore(null),
    toasts,
    detailsDelayMs: 0,
    clipboard: async () => {},
  });
  cleanups.push(() => store.dispose());
  await store.start();
  await until(() => store.hasLoaded, 'nạp xong');
  return { test, store, toasts };
}

function subjects(root: string, count: number): string[] {
  return rawGit(root, ['log', '--format=%s', `-n${count}`])
    .trim()
    .split('\n');
}

function entryOf(store: RepoStore, subject: string) {
  for (let row = 0; ; row++) {
    const entry = store.entryAt(row);
    if (!entry) throw new Error(`không thấy ${subject}`);
    if (entry.commit.subject === subject) return entry;
  }
}

describe('RebaseSession', () => {
  const [one, two, three] = [fakeCommit('1', ['g']), fakeCommit('2', ['1']), fakeCommit('3', ['2'])];

  it('hiện mới → cũ, đổi chỗ / đổi việc theo chỉ số hiển thị, đặt lại về ban đầu', async () => {
    const session = new RebaseSession(fakeCommit('g'), 'main', [one, two, three], async (sha) => {
      return `Lời đầy đủ của ${sha}\n\nThân`;
    });
    expect(session.rows.map((step) => step.commit.id)).toEqual(['3', '2', '1']);
    expect(session.problem).toBe('unchanged');
    session.move(0, 2);
    expect(session.steps.map((step) => step.commit.id)).toEqual(['3', '1', '2']);
    session.setAction(0, 'fixup');
    expect(session.steps.at(-1)?.action).toBe('fixup');
    expect(session.problem).toBeNull();
    session.setAction(2, 'reword');
    await until(() => session.steps[0]?.message !== undefined, 'điền lời đầy đủ');
    expect(session.steps[0]?.message).toBe('Lời đầy đủ của 3\n\nThân');
    session.setMessage(2, '   ');
    expect(session.problem).toBe('emptyMessage');
    session.reset();
    expect(session.steps.map((step) => [step.commit.id, step.action])).toEqual([
      ['1', 'pick'],
      ['2', 'pick'],
      ['3', 'pick'],
    ]);
  });
});

describe('rebase tương tác trên repo thật', () => {
  it('menu commit mở hộp thoại; đảo, sửa lời, gộp; xong có Hoàn tác', async () => {
    const { test, store, toasts } = await openStore();
    const base = entryOf(store, 'gốc');
    const item = commitMenu(store, base)
      .filter(isMenuAction)
      .find((entry) => entry.title === strings.rebase.menu);
    expect(item).toBeDefined();
    expect(item?.disabled).toBeFalsy();

    await beginInteractiveRebase(store, base.commit);
    const session = rebaseEditor.current!;
    expect(session.rows.map((step) => step.commit.subject)).toEqual(['ba', 'hai', 'một']);
    session.move(2, 0); // "một" lên trên cùng (mới nhất)
    session.setAction(1, 'reword'); // ba
    session.setMessage(1, 'Ba — lời mới');
    session.setAction(2, 'squash'); // hai gộp vào… commit bên dưới không còn: hai đang dưới cùng
    expect(session.problem).toBe('leadingSquash');
    session.setAction(2, 'pick');
    session.setAction(0, 'fixup'); // một gộp vào "ba"
    const before = store.headOid;
    await runInteractiveRebase(store, session);
    expect(rebaseEditor.current).toBeNull();
    expect(subjects(test.root, 3)).toEqual(['Ba — lời mới', 'hai', 'gốc']);
    expect(
      rawGit(test.root, ['-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD'])
        .trim()
        .split('\n')
        .sort(),
    ).toEqual(['ba.txt', 'một.txt']);

    const toast = [...toasts.items].reverse().find((item) => item.title === strings.rebase.done('main'));
    toast?.actions.find((action) => action.title === strings.staging.undo)?.run();
    await until(() => store.headOid === before, 'hoàn tác rebase');
    expect(subjects(test.root, 4)).toEqual(['ba', 'hai', 'một', 'gốc']);
  });

  it('xung đột: dừng ở trạng thái rebase, báo xung đột; commit ngoài nhánh thì báo không rebase được', async () => {
    const { test, store, toasts } = await openStore((git, root) => {
      for (const [content, message] of [
        ['1', 'gốc'],
        ['2', 'hai'],
        ['3', 'ba'],
      ] as const) {
        writeFileSync(join(root, 'a.txt'), `${content}\n`);
        git('add', '.');
        git('commit', '-q', '-m', message);
      }
    });
    await beginInteractiveRebase(store, entryOf(store, 'gốc').commit);
    const session = rebaseEditor.current!;
    session.move(0, 1);
    await runInteractiveRebase(store, session);
    await until(() => store.operation?.kind === 'rebasing', 'đang rebase dở');
    expect(toasts.items.some((item) => item.title === strings.remote.conflict('Rebase'))).toBe(true);
    rawGit(test.root, ['rebase', '--abort']);

    rawGit(test.root, ['switch', '-q', '-c', 'khac', 'HEAD~1']);
    writeFileSync(join(test.root, 'b.txt'), 'b\n');
    rawGit(test.root, ['add', '.']);
    rawGit(test.root, ['commit', '-q', '-m', 'khác']);
    const other = rawGit(test.root, ['rev-parse', 'HEAD']).trim();
    rawGit(test.root, ['switch', '-q', 'main']);
    await store.refreshAndWait(7);
    await beginInteractiveRebase(store, fakeCommit(other));
    expect(rebaseEditor.current).toBeNull();
    expect(toasts.items.some((item) => item.title === strings.rebase.notOnBranch(other.slice(0, 7)))).toBe(
      true,
    );
  });
});
