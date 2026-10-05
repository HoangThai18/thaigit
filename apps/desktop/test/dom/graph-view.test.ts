// GraphView built with real Svelte in happy-dom (the graph canvas is replaced by a fake: happy-dom has no
// 2D canvas and no layout, so `stubLayout` feeds it viewport sizes).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GraphView from '../../src/lib/graph/GraphView.svelte';
import { DEFAULT_WIDTHS } from '../../src/lib/graph/columns.ts';
import { prefs } from '../../src/lib/stores/prefs.svelte.ts';
import { openLoaded, setupEdge, type LoadedRepo } from '../helpers/edge-repo.ts';
import { stubLayout } from '../helpers/dom-layout.ts';
import { fastImportLinear } from '../helpers/node-port.ts';

vi.mock('../../src/lib/graph/GraphCanvasLayer.svelte', () => ({ default: () => {} }));

const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(() => {
  cleanups.push(stubLayout({ width: 1200, height: 600 }));
  prefs.update({ columns: { ...DEFAULT_WIDTHS } });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function mountGraph(repo: LoadedRepo): Promise<HTMLElement> {
  cleanups.push(() => repo.cleanup());
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(GraphView, { target, props: { store: repo.store } });
  cleanups.push(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  await tick();
  flushSync();
  return target;
}

const rowsOf = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('[role="option"]'),
];
const listboxOf = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('[role="listbox"]')!;

function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

describe('GraphView: phím trên thanh đổi rộng cột (M4)', () => {
  it('chỉ đổi độ rộng cột, KHÔNG lan xuống điều hướng hàng (Home/End/↑/↓/PageUp/PageDown)', async () => {
    const repo = await openLoaded(setupEdge);
    const root = await mountGraph(repo);
    const rows = rowsOf(root);
    expect(rows.length).toBeGreaterThan(3);
    rows[2]?.click();
    flushSync();
    const selected = repo.store.selection;
    expect(repo.store.selectedRow).toBe(2);

    const resizer = root.querySelector<HTMLElement>('.resizer')!;
    expect(resizer).not.toBeNull();
    const before = prefs.value.columns.refs;
    press(resizer, 'ArrowRight');
    expect(prefs.value.columns.refs).toBe(before + 10);
    press(resizer, 'ArrowLeft', { shiftKey: true });
    expect(prefs.value.columns.refs).toBe(before + 10 - 30);
    press(resizer, 'Home');
    expect(prefs.value.columns.refs).toBe(DEFAULT_WIDTHS.refs);

    for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter']) {
      press(resizer, key);
      expect(repo.store.selection, `phím ${key} trên thanh đổi rộng`).toEqual(selected);
    }
    // On the listbox itself these keys still navigate rows.
    press(listboxOf(root), 'End');
    expect(repo.store.selectedRow).toBe(repo.store.entries.length - 1);
    press(listboxOf(root), 'Home');
    expect(repo.store.selectedRow).toBe(0);
  });
});

describe('GraphView: trình đọc màn hình (M5)', () => {
  it('tiêu đề cột nằm NGOÀI listbox; listbox chỉ chứa các hàng (option)', async () => {
    const repo = await openLoaded(setupEdge);
    const root = await mountGraph(repo);
    const listbox = listboxOf(root);
    expect(listbox).not.toBeNull();
    expect(listbox.querySelector('.hcell, .htitle, .resizer, .header')).toBeNull();
    expect(root.querySelector('.header')).not.toBeNull();
    expect(listbox.contains(root.querySelector('.header'))).toBe(false);
    for (const row of rowsOf(root)) expect(row.closest('[role="listbox"]')).toBe(listbox);
    expect(listbox.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('mỗi hàng có id duy nhất, aria-posinset / aria-setsize; aria-activedescendant trỏ vào hàng đang chọn', async () => {
    const repo = await openLoaded(setupEdge);
    const root = await mountGraph(repo);
    const rows = rowsOf(root);
    const total = repo.store.entries.length;
    const ids = rows.map((row) => row.id);
    expect(ids.every((id) => id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    rows.forEach((row, index) => {
      expect(row.getAttribute('aria-setsize')).toBe(String(total));
      expect(row.getAttribute('aria-posinset')).toBe(String(index + 1));
    });

    const listbox = listboxOf(root);
    const selected = repo.store.selectedRow;
    expect(selected).not.toBeNull();
    expect(listbox.getAttribute('aria-activedescendant')).toBe(rows[selected!]?.id);
    expect(rows[selected!]?.getAttribute('aria-selected')).toBe('true');

    press(listbox, 'ArrowDown');
    await tick();
    flushSync();
    const next = repo.store.selectedRow!;
    expect(next).toBe(Math.min(total - 1, selected! + 1));
    expect(listbox.getAttribute('aria-activedescendant')).toBe(rowsOf(root)[next]?.id);
    expect(document.getElementById(listbox.getAttribute('aria-activedescendant')!)).not.toBeNull();
  });

  it('hàng đang chọn nằm ngoài vùng đã dựng (ảo hoá): không để aria-activedescendant trỏ vào id không tồn tại', async () => {
    const repo = await openLoaded((git, root) => fastImportLinear(git, root, 300), { commitLimit: 1000 });
    const root = await mountGraph(repo);
    const last = repo.store.entries.at(-1)!.commit.id;
    repo.store.select({ kind: 'commit', sha: last });
    flushSync();
    await tick();
    flushSync();
    const active = listboxOf(root).getAttribute('aria-activedescendant');
    if (active !== null) expect(document.getElementById(active)).not.toBeNull();
    expect(rowsOf(root).length).toBeLessThan(repo.store.entries.length);
  });
});
