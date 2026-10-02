/**
 * Cột của bảng graph và luật co/ẩn khi hẹp (port `CommitTable.fitColumns` của CommitGraphView.swift):
 * cột "Commit" lấp phần còn lại; thiếu chỗ thì co tạm Tác giả → Thời gian → Nhánh/Tag tới mức tối thiểu; vẫn thiếu thì ẩn
 * lần lượt SHA → Thời gian → Tác giả (hiện lại khi rộng ra) thay vì bắt cuộn ngang. Hàm thuần, không đụng DOM.
 */
import { graphWidth } from './style.ts';

export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'date' | 'sha';

/** Thứ tự hiển thị từ trái sang phải. */
export const COLUMN_ORDER: readonly ColumnId[] = ['refs', 'graph', 'message', 'author', 'date', 'sha'];

/** Các cột có độ rộng do người dùng chỉnh (và được nhớ). `graph` tự tính theo số làn; `message` lấp phần còn lại. */
export type SizedColumn = 'refs' | 'author' | 'date' | 'sha';

export interface ColumnLimits {
  min: number;
  max: number;
}

export const COLUMN_LIMITS: Readonly<Record<SizedColumn, ColumnLimits>> = {
  refs: { min: 60, max: 600 },
  author: { min: 60, max: 400 },
  date: { min: 60, max: 300 },
  sha: { min: 50, max: 160 },
};

export const DEFAULT_WIDTHS: Readonly<Record<SizedColumn, number>> = {
  refs: 190,
  author: 130,
  date: 122,
  sha: 74,
};

/** Độ rộng tối thiểu của cột Commit: dưới mức này thì co/ẩn các cột phụ. */
export const MESSAGE_MIN = 160;

/** Cột co được khi thiếu chỗ, theo thứ tự co, kèm mức tối thiểu khi co. */
const SHRINK_ORDER: readonly { id: SizedColumn; floor: number }[] = [
  { id: 'author', floor: 90 },
  { id: 'date', floor: 116 },
  { id: 'refs', floor: 110 },
];

/** Thứ tự ẩn khi vẫn thiếu chỗ sau khi co. */
const HIDE_ORDER: readonly SizedColumn[] = ['sha', 'date', 'author'];

export type PreferredWidths = Readonly<Record<SizedColumn, number>>;

export interface ColumnLayout {
  /** Độ rộng thực của mọi cột đang hiện (cột ẩn không có khoá). */
  widths: Partial<Record<ColumnId, number>>;
  /** Cột đang hiện theo thứ tự trái → phải. */
  visible: ColumnId[];
}

export function clampWidth(id: SizedColumn, width: number): number {
  const { min, max } = COLUMN_LIMITS[id];
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Độ rộng cột Graph theo số làn: tối đa 40 làn, kẹp trong 64…640 px. */
export function graphColumnWidth(lanes: number): number {
  return Math.min(640, Math.max(64, graphWidth(Math.min(lanes, 40))));
}

/** Đọc độ rộng đã lưu (dữ liệu không tin cậy): thiếu/sai → mặc định, ngoài khoảng → kẹp. */
export function sanitizePreferred(raw: unknown): PreferredWidths {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_WIDTHS };
  for (const id of Object.keys(DEFAULT_WIDTHS) as SizedColumn[]) {
    const value = source[id];
    if (typeof value === 'number' && Number.isFinite(value)) result[id] = clampWidth(id, value);
  }
  return result;
}

/**
 * Tính độ rộng/ẩn hiện cột trong bề ngang `available`. `preferred` là độ rộng người dùng muốn; `graph` là độ rộng cột Graph.
 */
export function fitColumns(available: number, preferred: PreferredWidths, graph: number): ColumnLayout {
  let hidden = new Set<SizedColumn>();
  let widths: Record<SizedColumn, number> = { ...preferred };
  const othersWidth = (): number => {
    let total = graph;
    for (const id of Object.keys(widths) as SizedColumn[]) if (!hidden.has(id)) total += widths[id];
    return total;
  };

  for (let level = 0; level <= HIDE_ORDER.length; level++) {
    hidden = new Set(HIDE_ORDER.slice(0, level));
    widths = { ...preferred };
    let deficit = MESSAGE_MIN - (available - othersWidth());
    for (const { id, floor } of SHRINK_ORDER) {
      if (deficit <= 0) break;
      if (hidden.has(id)) continue;
      const shrink = Math.min(deficit, Math.max(0, widths[id] - floor));
      widths[id] -= shrink;
      deficit -= shrink;
    }
    if (deficit <= 0) break;
  }

  const result: ColumnLayout = { widths: { graph }, visible: [] };
  for (const id of COLUMN_ORDER) {
    if (id === 'graph') result.widths.graph = graph;
    else if (id === 'message') result.widths.message = Math.max(MESSAGE_MIN, available - othersWidth());
    else if (!hidden.has(id)) result.widths[id] = widths[id];
    if (id === 'graph' || id === 'message' || !hidden.has(id)) result.visible.push(id);
  }
  return result;
}
