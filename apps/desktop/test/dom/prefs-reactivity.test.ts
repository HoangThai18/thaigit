// PrefsStore.update may only report "changed" for keys that really changed: dragging the splitter (dozens
// of `sidebarWidth` updates per second) must not make everything derived from `sidebarSections` / `columns`
// (the branch tree, the column layout) recompute.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WIDTHS } from '../../src/lib/graph/columns.ts';
import { PREFS_KEY, PrefsStore, type KeyValueStorage } from '../../src/lib/stores/prefs.svelte.ts';
import { watchPrefs } from '../helpers/effects.svelte.ts';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function watch(prefs: PrefsStore) {
  const watcher = watchPrefs(prefs);
  stops.push(watcher.stop);
  return watcher;
}

describe('PrefsStore.update: chỉ khoá đổi mới đổi (M6)', () => {
  it('đổi sidebarWidth nhiều lần: sidebarSections / columns / scheme không "đổi"', () => {
    const prefs = new PrefsStore(null);
    const watcher = watch(prefs);
    const base = { ...watcher.counts };
    for (let index = 0; index < 10; index++) {
      prefs.update({ sidebarWidth: 250 + index });
      watcher.flush();
    }
    expect(prefs.value.sidebarWidth).toBe(259);
    expect(watcher.counts).toEqual(base);
  });

  it('đổi một khoá con thì chỉ nhóm đó đổi; đặt lại đúng giá trị cũ (object mới, nội dung bằng nhau) thì không đổi', () => {
    const prefs = new PrefsStore(null);
    const watcher = watch(prefs);
    const base = { ...watcher.counts };

    prefs.update({ columns: { ...prefs.value.columns, refs: 220 } });
    watcher.flush();
    expect(prefs.value.columns.refs).toBe(220);
    expect(watcher.counts).toEqual({ ...base, columns: base.columns + 1 });

    prefs.update({ columns: { ...prefs.value.columns } });
    prefs.update({ sidebarSections: { ...prefs.value.sidebarSections } });
    watcher.flush();
    expect(watcher.counts).toEqual({ ...base, columns: base.columns + 1 });

    prefs.update({ sidebarSections: { ...prefs.value.sidebarSections, tags: true } });
    watcher.flush();
    expect(prefs.value.sidebarSections.tags).toBe(true);
    expect(watcher.counts).toEqual({ ...base, columns: base.columns + 1, sections: base.sections + 1 });

    prefs.update({ scheme: 'dark' });
    watcher.flush();
    expect(watcher.counts.scheme).toBe(base.scheme + 1);
    expect(watcher.counts.sections).toBe(base.sections + 1);
  });

  it('vẫn kẹp giá trị sai và ghi đúng xuống kho (kể cả khoá không đổi)', () => {
    const saved = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => void saved.set(key, value),
    };
    const prefs = new PrefsStore(storage);
    prefs.update({ sidebarWidth: 99999, columns: { ...DEFAULT_WIDTHS, refs: 5 } });
    expect(prefs.value.sidebarWidth).toBe(440);
    expect(prefs.value.columns.refs).toBe(60);
    prefs.flush();
    const stored = JSON.parse(saved.get(PREFS_KEY) ?? '{}') as {
      sidebarWidth: number;
      columns: { refs: number };
      scheme: string;
    };
    expect(stored).toMatchObject({ sidebarWidth: 440, columns: { refs: 60 }, scheme: 'system' });
  });
});
