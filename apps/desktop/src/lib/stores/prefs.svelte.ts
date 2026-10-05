/**
 * User preferences kept in localStorage (the webview). For now only the few values the graph / sidebar / layout need; the
 * Settings screen (4b) edits exactly these fields. Data read back always goes through `sanitizePrefs` (localStorage can be
 * edited or corrupt).
 */
import { snapshotSpec } from '@thaigit/contracts';
import type { LogOrder } from '@thaigit/core';
import { DEFAULT_WIDTHS, sanitizePreferred, type PreferredWidths } from '../graph/columns.ts';
import { jsonEqual } from './equality.ts';

export const PREFS_KEY = 'thaigit.prefs.v1';

export type ColorScheme = 'system' | 'light' | 'dark';

/** The default pull style (a preference). `ff-only` ↔ core's `PullMode` `'fastForwardOnly'` (mapped in `actions/remote.ts`). */
export type PullModePref = 'merge' | 'rebase' | 'ff-only';
export type DiffLayout = 'unified' | 'split';
const PULL_MODES: readonly PullModePref[] = ['merge', 'rebase', 'ff-only'];

export interface PrefsData {
  /** How many commits to load at a time (Swift: default 2000, minimum 200). */
  commitLimit: number;
  logOrder: LogOrder;
  showRemoteBranches: boolean;
  showTags: boolean;
  relativeDates: boolean;
  scheme: ColorScheme;
  /** `false` → the `no-glass` class: a solid background instead of the blurred one. */
  glass: boolean;
  showSidebar: boolean;
  showInspector: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarSections: {
    local: boolean;
    remote: boolean;
    tags: boolean;
    stashes: boolean;
    pullRequests: boolean;
    worktrees: boolean;
    submodules: boolean;
    lfs: boolean;
  };
  columns: PreferredWidths;
  /** The Pull button's pull style (default `merge`). */
  pullMode: PullModePref;
  /** `fetch --prune`: drop remote branches deleted on the server (on by default). */
  fetchPrune: boolean;
  /** The autofetch interval in minutes; 0 = off. */
  autoFetchMinutes: number;
  /** Context lines around each hunk when viewing a diff (`-U<n>`). */
  diffContext: number;
  /** Unified diff (one column) or split (old | new). */
  diffLayout: DiffLayout;
  /** Show the changed files as a folder tree (Path / Tree, like GitKraken). */
  fileListTree: boolean;
  /** Real avatars on graph nodes. Off means no image is downloaded at all (Swift: `AvatarStore.enabledKey`). */
  showAvatars: boolean;
  /** Ignore whitespace-only changes in diffs (`--ignore-all-space`). */
  diffIgnoreWhitespace: boolean;
  /** Automatically snapshot the working folder when files change (the timeline). */
  snapshotsEnabled: boolean;
  snapshotKeepDays: number;
  snapshotKeepCount: number;
  /** A repo root (path) where autosave is disabled on its own. */
  snapshotsDisabledRepos: string[];
  /** The first-run explanation of autosave has been shown. */
  snapshotNoticeShown: boolean;
  /** Repos open in the main window's tabs (ids from the recent list) — reopened when the app starts. */
  openTabs: string[];
  /** The selected tab's position in `openTabs`. */
  activeTab: number;
}

export const SIDEBAR_LIMITS = { min: 210, max: 440, ideal: 260 } as const;
export const INSPECTOR_LIMITS = { min: 300, max: 640, ideal: 380 } as const;
export const COMMIT_LIMIT_MIN = 200;
export const COMMIT_LIMIT_MAX = 200_000;
/** 0 = autofetch off; cap 24 hours. */
export const AUTO_FETCH_MINUTES_MAX = 1440;
export const DIFF_CONTEXT_MAX = 100;
export const SNAPSHOT_KEEP_DAYS = { min: 1, max: 90 } as const;
export const SNAPSHOT_KEEP_COUNT = { min: 20, max: 2000 } as const;
/** Cap on how many repos stay in the autosave-disabled list (localStorage cannot grow forever). */
const SNAPSHOT_DISABLED_MAX = 500;
const OPEN_TABS_MAX = 20;

export function defaultPrefs(): PrefsData {
  return {
    commitLimit: 2000,
    logOrder: 'date',
    showRemoteBranches: true,
    showTags: true,
    relativeDates: true,
    scheme: 'system',
    glass: true,
    showSidebar: true,
    showInspector: true,
    sidebarWidth: SIDEBAR_LIMITS.ideal,
    inspectorWidth: INSPECTOR_LIMITS.ideal,
    sidebarSections: {
      local: true,
      remote: true,
      tags: false,
      stashes: true,
      pullRequests: false,
      worktrees: true,
      submodules: true,
      lfs: true,
    },
    columns: { ...DEFAULT_WIDTHS },
    pullMode: 'merge',
    fetchPrune: true,
    autoFetchMinutes: 10,
    diffContext: 3,
    diffLayout: 'unified',
    fileListTree: false,
    showAvatars: true,
    diffIgnoreWhitespace: false,
    snapshotsEnabled: true,
    snapshotKeepDays: snapshotSpec.defaults.keepDays,
    snapshotKeepCount: snapshotSpec.defaults.keepCount,
    snapshotsDisabledRepos: [],
    snapshotNoticeShown: false,
    openTabs: [],
    activeTab: 0,
  };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''));
  return [...unique].slice(-max);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/** Turn raw stored data (already `JSON.parse`d) into a valid `PrefsData`: a missing or mistyped field falls back to its default, numbers are clamped. */
export function sanitizePrefs(raw: unknown): PrefsData {
  const base = defaultPrefs();
  if (typeof raw !== 'object' || raw === null) return base;
  const source = raw as Record<string, unknown>;
  const sections =
    typeof source.sidebarSections === 'object' && source.sidebarSections !== null
      ? (source.sidebarSections as Record<string, unknown>)
      : {};
  return {
    commitLimit: clamp(source.commitLimit, COMMIT_LIMIT_MIN, COMMIT_LIMIT_MAX, base.commitLimit),
    logOrder: source.logOrder === 'topo' ? 'topo' : 'date',
    showRemoteBranches: bool(source.showRemoteBranches, base.showRemoteBranches),
    showTags: bool(source.showTags, base.showTags),
    relativeDates: bool(source.relativeDates, base.relativeDates),
    scheme: source.scheme === 'light' || source.scheme === 'dark' ? source.scheme : 'system',
    glass: bool(source.glass, base.glass),
    showSidebar: bool(source.showSidebar, base.showSidebar),
    showInspector: bool(source.showInspector, base.showInspector),
    sidebarWidth: clamp(source.sidebarWidth, SIDEBAR_LIMITS.min, SIDEBAR_LIMITS.max, base.sidebarWidth),
    inspectorWidth: clamp(
      source.inspectorWidth,
      INSPECTOR_LIMITS.min,
      INSPECTOR_LIMITS.max,
      base.inspectorWidth,
    ),
    sidebarSections: {
      local: bool(sections.local, base.sidebarSections.local),
      remote: bool(sections.remote, base.sidebarSections.remote),
      tags: bool(sections.tags, base.sidebarSections.tags),
      stashes: bool(sections.stashes, base.sidebarSections.stashes),
      pullRequests: bool(sections.pullRequests, base.sidebarSections.pullRequests),
      worktrees: bool(sections.worktrees, base.sidebarSections.worktrees),
      submodules: bool(sections.submodules, base.sidebarSections.submodules),
      lfs: bool(sections.lfs, base.sidebarSections.lfs),
    },
    columns: sanitizePreferred(source.columns),
    pullMode: PULL_MODES.find((mode) => mode === source.pullMode) ?? base.pullMode,
    fetchPrune: bool(source.fetchPrune, base.fetchPrune),
    autoFetchMinutes: clamp(source.autoFetchMinutes, 0, AUTO_FETCH_MINUTES_MAX, base.autoFetchMinutes),
    diffContext: clamp(source.diffContext, 0, DIFF_CONTEXT_MAX, base.diffContext),
    diffLayout: source.diffLayout === 'split' ? 'split' : 'unified',
    fileListTree: bool(source.fileListTree, base.fileListTree),
    showAvatars: bool(source.showAvatars, base.showAvatars),
    diffIgnoreWhitespace: bool(source.diffIgnoreWhitespace, base.diffIgnoreWhitespace),
    snapshotsEnabled: bool(source.snapshotsEnabled, base.snapshotsEnabled),
    snapshotKeepDays: clamp(
      source.snapshotKeepDays,
      SNAPSHOT_KEEP_DAYS.min,
      SNAPSHOT_KEEP_DAYS.max,
      base.snapshotKeepDays,
    ),
    snapshotKeepCount: clamp(
      source.snapshotKeepCount,
      SNAPSHOT_KEEP_COUNT.min,
      SNAPSHOT_KEEP_COUNT.max,
      base.snapshotKeepCount,
    ),
    snapshotsDisabledRepos: stringList(source.snapshotsDisabledRepos, SNAPSHOT_DISABLED_MAX),
    snapshotNoticeShown: bool(source.snapshotNoticeShown, base.snapshotNoticeShown),
    openTabs: stringList(source.openTabs, OPEN_TABS_MAX),
    activeTab: clamp(source.activeTab, 0, OPEN_TABS_MAX - 1, base.activeTab),
  };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage when it is usable (it can throw when blocked), otherwise `null`. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const SAVE_DELAY_MS = 250;

export class PrefsStore {
  /** A deeply reactive proxy: reading `prefs.value.showTags` depends on exactly that one field. */
  value = $state<PrefsData>(defaultPrefs());
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {
    let raw: unknown;
    try {
      const text = storage?.getItem(PREFS_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.value = sanitizePrefs(raw);
  }

  /**
   * Merge `patch` (clamped to valid values), then write it to storage after a short delay (dragging the splitter calls it repeatedly).
   * Only keys that REALLY changed are written (compared by content): assigning a fresh child object to
   * `sidebarSections`/`columns` every time would recompute everything derived from them (the branch tree, the column layout) even
   * when only `sidebarWidth` changed.
   */
  update(patch: Partial<PrefsData>): void {
    const current = $state.snapshot(this.value) as PrefsData;
    const next = sanitizePrefs({ ...current, ...patch });
    const target = this.value as Record<keyof PrefsData, unknown>;
    for (const key of Object.keys(next) as (keyof PrefsData)[]) {
      if (!jsonEqual(current[key], next[key])) target[key] = next[key];
    }
    this.scheduleSave();
  }

  /** Write immediately (on window close or in tests). */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify($state.snapshot(this.value)));
    } catch {
      // Out of quota / blocked: the preferences only live for this session.
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }
}

export const prefs = new PrefsStore();
