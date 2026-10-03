// Tên nhánh / tệp chứa ký tự đảo chiều (`fix-‮gnp.exe` hiện thành `fix-exe.png`) phải hiện ký hiệu thay vì đảo chữ, và nằm trong
// <bdi> để không kéo đổi thứ tự chữ xung quanh (L3).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, tick, unmount, type Component, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommitDetail from '../../src/lib/inspector/CommitDetail.svelte';
import FileList from '../../src/lib/inspector/FileList.svelte';
import StashDetail from '../../src/lib/inspector/StashDetail.svelte';
import WipPanel from '../../src/lib/inspector/WipPanel.svelte';
import GraphView from '../../src/lib/graph/GraphView.svelte';
import RepoWindow from '../../src/lib/shell/RepoWindow.svelte';
import Sidebar from '../../src/lib/sidebar/Sidebar.svelte';
import { stubLayout } from '../helpers/dom-layout.ts';
import { commitFile, openLoaded, until, type LoadedRepo } from '../helpers/edge-repo.ts';
import { rawGit } from '../helpers/node-port.ts';

vi.mock('../../src/lib/graph/GraphCanvasLayer.svelte', () => ({ default: () => {} }));

const RLO = '‮';
const BRANCH = `fix-${RLO}gnp.exe`;
const FILE = `anh-${RLO}gpj.exe`;

const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(() => cleanups.push(stubLayout({ width: 1200, height: 600 })));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function bidiRepo(): Promise<LoadedRepo> {
  const repo = await openLoaded((git, root) => {
    commitFile(git, root, 'a.txt', 'một\n', 'commit 1');
    commitFile(git, root, FILE, 'x\n', 'thêm tệp lạ');
    git('branch', BRANCH);
    git('tag', `v${RLO}1`);
  });
  cleanups.push(() => repo.cleanup());
  return repo;
}

// `any` ở đây chỉ để nhận mọi component Svelte; kiểu của `props` vẫn suy ra chính xác từ component (`ComponentProps`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountInto<C extends Component<any>>(component: C, props: ComponentProps<C>): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(component, { target, props });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  return target;
}

/** Không chữ nào hiển thị còn ký tự điều khiển bidi thô (kể cả trong `title`). */
function rawControls(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (/[‪-‮⁦-⁩‎‏؜]/.test(node.textContent ?? '')) found.push(`text: ${node.textContent}`);
    } else {
      for (const attribute of (node as Element).attributes) {
        if (/[‪-‮⁦-⁩‎‏؜]/.test(attribute.value)) {
          found.push(`${(node as Element).tagName}[${attribute.name}]`);
        }
      }
    }
  }
  return found;
}

describe('ký tự bidi trong tên nhánh / tag / tệp', () => {
  it('Sidebar: tên nhánh và tag hiện ký hiệu, nằm trong <bdi>', async () => {
    const repo = await bidiRepo();
    const root = mountInto(Sidebar, { store: repo.store });
    const titles = [...root.querySelectorAll('.sb-title')].map((element) => element.textContent);
    expect(titles).toContain('fix-‹RLO U+202E›gnp.exe');
    expect(root.querySelectorAll('.sb-title bdi').length).toBeGreaterThanOrEqual(2);
    expect(rawControls(root)).toEqual([]);
  });

  it('GraphView: nhãn (pill), tooltip và tiêu đề commit không còn ký tự đảo chiều thô', async () => {
    const repo = await bidiRepo();
    const root = mountInto(GraphView, { store: repo.store });
    await tick();
    flushSync();
    const pills = [...root.querySelectorAll('.pill-text')].map((element) => element.textContent);
    expect(pills.join('|')).toContain('fix-‹RLO U+202E›gnp.exe');
    expect(root.querySelectorAll('.pill-text bdi').length).toBeGreaterThan(0);
    expect(rawControls(root)).toEqual([]);
  });

  it('FileList: tên tệp có ký tự đảo chiều hiện ký hiệu, nằm trong <bdi>', async () => {
    const repo = await bidiRepo();
    const head = repo.store.headOid!;
    repo.store.select({ kind: 'commit', sha: head });
    await until(() => repo.store.details?.commit.id === head, 'chi tiết commit');
    const root = mountInto(FileList, { files: repo.store.details!.files, title: 'File thay đổi' });
    await tick();
    flushSync();
    const names = [...root.querySelectorAll('.name')].map((element) => element.textContent);
    expect(names).toEqual(['anh-‹RLO U+202E›gpj.exe']);
    expect(root.querySelectorAll('.name bdi')).toHaveLength(1);
    expect(rawControls(root)).toEqual([]);
  });

  it('Thanh công cụ (RepoWindow): tên nhánh hiện tại có ký tự đảo chiều cũng hiện ký hiệu', async () => {
    const repo = await bidiRepo();
    repo.test.git('switch', '-q', BRANCH);
    repo.store.refreshEverything();
    await until(() => repo.store.currentBranch === BRANCH, 'đã chuyển nhánh');
    const root = mountInto(RepoWindow, { store: repo.store, onclose() {} });
    await tick();
    flushSync();
    expect(root.querySelector('.branch-name')?.textContent).toBe('fix-‹RLO U+202E›gnp.exe');
    expect(root.querySelector('.branch-name bdi')).not.toBeNull();
    expect(rawControls(root)).toEqual([]);
  });

  it('CommitDetail: tiêu đề, thân message, tên + email tác giả/committer có ký tự đảo chiều hiện ký hiệu, nằm trong <bdi>', async () => {
    const repo = await openLoaded((git, root) => {
      commitFile(git, root, 'a.txt', 'một\n', 'commit 1');
      writeFileSync(join(root, 'b.txt'), 'hai\n');
      git('add', '--', 'b.txt');
      rawGit(
        root,
        ['commit', '-q', '-m', `sửa ${RLO}gnp.exe`, '-m', `thân ${RLO}trộn\ndòng hai`],
        undefined,
        {
          GIT_AUTHOR_NAME: `Ng${RLO}uyen`,
          GIT_AUTHOR_EMAIL: `a${RLO}b@x.vn`,
          GIT_COMMITTER_NAME: `Co${RLO}mmitter`,
        },
      );
    });
    cleanups.push(() => repo.cleanup());
    const sha = repo.store.headOid!;
    repo.store.select({ kind: 'commit', sha });
    await until(() => repo.store.details?.commit.id === sha, 'chi tiết commit');
    const root = mountInto(CommitDetail, { store: repo.store, sha });
    await tick();
    flushSync();
    const text = (selector: string): string | undefined => root.querySelector(selector)?.textContent?.trim();
    expect(text('.summary')).toBe('sửa ‹RLO U+202E›gnp.exe');
    expect(text('.body')).toBe('thân ‹RLO U+202E›trộn\ndòng hai');
    expect(text('.author .name')).toBe('Ng‹RLO U+202E›uyen');
    expect(text('.author .email')).toBe('a‹RLO U+202E›b@x.vn');
    expect(text('.committer')).toContain('Co‹RLO U+202E›mmitter');
    for (const selector of ['.summary', '.body', '.author .name', '.author .email', '.committer']) {
      expect(root.querySelector(`${selector} bdi`), selector).not.toBeNull();
    }
    expect(rawControls(root)).toEqual([]);
  });

  it('StashDetail: lời nhắn và tên nhánh gốc có ký tự đảo chiều hiện ký hiệu, nằm trong <bdi>', async () => {
    const repo = await openLoaded((git, root) => {
      commitFile(git, root, 'a.txt', 'một\n', 'commit 1');
      git('switch', '-q', '-c', BRANCH);
      writeFileSync(join(root, 'a.txt'), 'sửa dở\n');
      git('stash', 'push', '-q', '-m', `dở ${RLO}gnp`);
    });
    cleanups.push(() => repo.cleanup());
    const stash = repo.store.stashes[0]!;
    repo.store.select({ kind: 'stash', sha: stash.sha });
    await until(() => repo.store.details?.commit.id === stash.sha, 'chi tiết stash');
    const root = mountInto(StashDetail, { store: repo.store, sha: stash.sha });
    await tick();
    flushSync();
    expect(root.querySelector('.message')?.textContent?.trim()).toBe('dở ‹RLO U+202E›gnp');
    expect(root.querySelector('.meta')?.textContent).toContain('fix-‹RLO U+202E›gnp.exe');
    expect(root.querySelector('.message bdi')).not.toBeNull();
    expect(root.querySelector('.meta bdi')).not.toBeNull();
    expect(rawControls(root)).toEqual([]);
  });

  it('WipPanel: tên tệp chưa commit có ký tự đảo chiều hiện ký hiệu (qua FileList)', async () => {
    const repo = await openLoaded((git, root) => {
      commitFile(git, root, 'a.txt', 'một\n', 'commit 1');
      writeFileSync(join(root, FILE), 'x\n');
    });
    cleanups.push(() => repo.cleanup());
    expect(repo.store.status.unstaged.length).toBeGreaterThan(0);
    const root = mountInto(WipPanel, { store: repo.store });
    await tick();
    flushSync();
    const names = [...root.querySelectorAll('.name')].map((element) => element.textContent?.trim());
    expect(names).toEqual(['anh-‹RLO U+202E›gpj.exe']);
    expect(root.querySelectorAll('.name bdi')).toHaveLength(1);
    expect(rawControls(root)).toEqual([]);
  });
});
