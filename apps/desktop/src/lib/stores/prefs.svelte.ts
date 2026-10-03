/**
 * Cài đặt người dùng lưu ở localStorage (webview). Hôm nay chỉ vài giá trị mà graph/sidebar/bố cục cần; màn Cài đặt (4b)
 * sẽ sửa chính các trường này. Dữ liệu đọc ra luôn qua `sanitizePrefs` (localStorage có thể bị sửa/hỏng).
 */
import { snapshotSpec } from '@thaigit/contracts';
import type { LogOrder } from '@thaigit/core';
import { DEFAULT_WIDTHS, sanitizePreferred, type PreferredWidths } from '../graph/columns.ts';
import { jsonEqual } from './equality.ts';

export const PREFS_KEY = 'thaigit.prefs.v1';

export type ColorScheme = 'system' | 'light' | 'dark';

/** Kiểu pull mặc định (cài đặt). `ff-only` ↔ `PullMode` `'fastForwardOnly'` của core (ánh xạ ở `actions/remote.ts`). */
export type PullModePref = 'merge' | 'rebase' | 'ff-only';
export type DiffLayout = 'unified' | 'split';
const PULL_MODES: readonly PullModePref[] = ['merge', 'rebase', 'ff-only'];

export interface PrefsData {
  /** Số commit tải mỗi lần (Swift: mặc định 2000, tối thiểu 200). */
  commitLimit: number;
  logOrder: LogOrder;
  showRemoteBranches: boolean;
  showTags: boolean;
  relativeDates: boolean;
  scheme: ColorScheme;
  /** `false` → lớp `no-glass`: nền đặc thay cho kính. */
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
  };
  columns: PreferredWidths;
  /** Kiểu pull của nút Pull (mặc định `merge`). */
  pullMode: PullModePref;
  /** `fetch --prune`: dọn nhánh remote đã bị xoá (mặc định bật). */
  fetchPrune: boolean;
  /** Chu kỳ tự fetch (phút); 0 = tắt. */
  autoFetchMinutes: number;
  /** Số dòng ngữ cảnh quanh mỗi hunk khi xem diff (`-U<n>`). */
  diffContext: number;
  /** Diff gộp (một cột) hay tách đôi (cũ | mới). */
  diffLayout: DiffLayout;
  /** Tự lưu snapshot thư mục làm việc khi file đổi (Dòng thời gian). */
  snapshotsEnabled: boolean;
  snapshotKeepDays: number;
  snapshotKeepCount: number;
  /** Gốc repo (đường dẫn) đã tắt tự lưu riêng. */
  snapshotsDisabledRepos: string[];
  /** Đã hiện thông báo giải thích lần đầu tự lưu. */
  snapshotNoticeShown: boolean;
}

export const SIDEBAR_LIMITS = { min: 210, max: 440, ideal: 260 } as const;
export const INSPECTOR_LIMITS = { min: 300, max: 640, ideal: 380 } as const;
export const COMMIT_LIMIT_MIN = 200;
export const COMMIT_LIMIT_MAX = 200_000;
/** 0 = tắt tự fetch; trần 24 giờ. */
export const AUTO_FETCH_MINUTES_MAX = 1440;
export const DIFF_CONTEXT_MAX = 100;
export const SNAPSHOT_KEEP_DAYS = { min: 1, max: 90 } as const;
export const SNAPSHOT_KEEP_COUNT = { min: 20, max: 2000 } as const;
/** Trần số repo trong danh sách tắt tự lưu (localStorage không phình mãi). */
const SNAPSHOT_DISABLED_MAX = 500;

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
    sidebarSections: { local: true, remote: true, tags: false, stashes: true, pullRequests: false },
    columns: { ...DEFAULT_WIDTHS },
    pullMode: 'merge',
    fetchPrune: true,
    autoFetchMinutes: 10,
    diffContext: 3,
    diffLayout: 'unified',
    snapshotsEnabled: true,
    snapshotKeepDays: snapshotSpec.defaults.keepDays,
    snapshotKeepCount: snapshotSpec.defaults.keepCount,
    snapshotsDisabledRepos: [],
    snapshotNoticeShown: false,
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

/** Biến dữ liệu thô (đã `JSON.parse`) thành `PrefsData` hợp lệ: trường thiếu/sai kiểu lấy mặc định, số bị kẹp. */
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
    },
    columns: sanitizePreferred(source.columns),
    pullMode: PULL_MODES.find((mode) => mode === source.pullMode) ?? base.pullMode,
    fetchPrune: bool(source.fetchPrune, base.fetchPrune),
    autoFetchMinutes: clamp(source.autoFetchMinutes, 0, AUTO_FETCH_MINUTES_MAX, base.autoFetchMinutes),
    diffContext: clamp(source.diffContext, 0, DIFF_CONTEXT_MAX, base.diffContext),
    diffLayout: source.diffLayout === 'split' ? 'split' : 'unified',
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
  };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage nếu dùng được (có thể ném lỗi khi bị chặn), không thì `null`. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const SAVE_DELAY_MS = 250;

export class PrefsStore {
  /** Proxy phản ứng sâu: đọc `prefs.value.showTags` chỉ phụ thuộc đúng trường đó. */
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
   * Gộp `patch` (kẹp lại cho hợp lệ) rồi ghi xuống kho sau một nhịp (kéo thanh chia đôi gọi liên tục). Chỉ gán khoá THẬT SỰ đổi
   * (so sánh theo nội dung): gán object con mới cho `sidebarSections`/`columns` mỗi lần sẽ làm mọi giá trị dẫn xuất từ chúng
   * (cây nhánh, bố cục cột) tính lại dù chỉ đổi `sidebarWidth`.
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

  /** Ghi ngay (khi đóng cửa sổ hoặc test). */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify($state.snapshot(this.value)));
    } catch {
      // Hết dung lượng / bị chặn: cài đặt chỉ sống trong phiên này.
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }
}

export const prefs = new PrefsStore();
