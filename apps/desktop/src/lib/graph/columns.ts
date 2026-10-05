/**
 * Graph table columns and the shrink/hide rules when narrow (a port of `CommitTable.fitColumns` in
 * CommitGraphView.swift): the "Commit" column takes the remaining space; when space runs short, Author →
 * Date → Branch/Tag shrink to their minimums in turn; if it is still too narrow, SHA → Date → Author are
 * hidden (and reappear when there is room again) instead of forcing a horizontal scroll. Pure functions,
 * no DOM access.
 */
import { graphWidth } from './style.ts';

export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'date' | 'sha';

/** Display order, left to right. */
export const COLUMN_ORDER: readonly ColumnId[] = ['refs', 'graph', 'message', 'author', 'date', 'sha'];

/** Columns whose width the user can set (and which are remembered). `graph` is computed from the lane count; `message` fills the rest. */
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

/** Minimum width of the Commit column: below this, secondary columns start shrinking/hiding. */
export const MESSAGE_MIN = 160;

/** Columns that shrink when space is short, in shrink order, with their minimum shrunk width. */
const SHRINK_ORDER: readonly { id: SizedColumn; floor: number }[] = [
  { id: 'author', floor: 90 },
  { id: 'date', floor: 116 },
  { id: 'refs', floor: 110 },
];

/** Hide order used when the table is still too narrow after shrinking. */
const HIDE_ORDER: readonly SizedColumn[] = ['sha', 'date', 'author'];

export type PreferredWidths = Readonly<Record<SizedColumn, number>>;

export interface ColumnLayout {
  /** Effective width of every visible column (a hidden column has no entry). */
  widths: Partial<Record<ColumnId, number>>;
  /** Visible columns, in left-to-right order. */
  visible: ColumnId[];
}

export function clampWidth(id: SizedColumn, width: number): number {
  const { min, max } = COLUMN_LIMITS[id];
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Graph column width from the lane count: at most 40 lanes, clamped to 64…640 px. */
export function graphColumnWidth(lanes: number): number {
  return Math.min(640, Math.max(64, graphWidth(Math.min(lanes, 40))));
}

/** Read a stored width (persisted data is untrusted): missing/invalid → default, out of range → clamped. */
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
 * Compute column widths and visibility for the horizontal extent `available`. `preferred` holds the widths the
 * user asked for; `graph` is the Graph column width.
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
