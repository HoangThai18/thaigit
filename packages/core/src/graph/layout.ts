// Xếp commit vào các làn của graph (port GraphLayout.swift, kết quả giống hệt). Hàm thuần: chạy được trong Web Worker.
//
// Đầu vào là các commit đã sắp con trước cha (như `git log --date-order/--topo-order`). Mỗi làn chờ một commit cha.
// Nhánh giữ nguyên làn cho tới điểm rẽ nhánh, rồi uốn cong vào node cha (giống GitKraken), nên các đường thẳng và ít
// cắt nhau. Màu theo cột (làn): làn 0 luôn một màu, hai làn cạnh nhau luôn khác màu, và màu không nhảy lung tung khi
// lịch sử thay đổi.

import { WORKING_TREE_ID, type Commit } from '../git/models.ts';

/** Màu của đường nét đứt từ node WIP xuống HEAD. */
export const WORKING_TREE_COLOR = -1;

export type GraphLineKind =
  /** Đường đi thẳng qua cả hàng trong làn `lane`. */
  | 'pass'
  /** Nửa trên: từ đỉnh làn `lane` đi vào node của hàng. */
  | 'toNode'
  /** Nửa dưới: từ node đi xuống đáy làn `lane`. */
  | 'fromNode';

/** Một đoạn đường cần vẽ trong một hàng. Bất biến và được dùng chung giữa các hàng (structured clone giữ nguyên chia sẻ). */
export interface GraphLine {
  readonly kind: GraphLineKind;
  readonly lane: number;
  /** Chỉ số màu; `WORKING_TREE_COLOR` là đường nét đứt của WIP. */
  readonly color: number;
}

export interface GraphRow {
  readonly lane: number;
  readonly color: number;
  readonly lines: readonly GraphLine[];
  /** Số làn cần để vẽ hàng này. */
  readonly width: number;
}

/** Phần của commit mà layout cần. */
export type GraphCommit = Pick<Commit, 'id' | 'parents'>;

interface Lane {
  sha: string;
  /** Đường nét đứt từ node WIP xuống HEAD. */
  isWorkingTree: boolean;
}

const KIND_INDEX: Record<GraphLineKind, number> = { pass: 0, toNode: 1, fromNode: 2 };

/** Đọc một lần: truy cập export của module trong vòng lặp nóng có thể chậm khi chạy dưới bộ nạp module của test. */
const WIP_ID = WORKING_TREE_ID;

/** Hàng chục nghìn commit × hàng chục làn → hàng triệu đường; chỉ có vài trăm bộ (kind, lane, color) khác nhau nên dùng chung đối tượng. */
class LineCache {
  private readonly lines = new Map<number, GraphLine>();

  get(kind: GraphLineKind, lane: number, color: number): GraphLine {
    // lane, color + 1 < 2^20 trong mọi repo thực tế; khoá còn nằm trong số nguyên an toàn của JS.
    const key = (lane * 1_048_576 + (color + 1)) * 3 + KIND_INDEX[kind];
    let line = this.lines.get(key);
    if (line === undefined) {
      line = Object.freeze({ kind, lane, color });
      this.lines.set(key, line);
    }
    return line;
  }
}

export function computeGraphLayout(commits: readonly GraphCommit[]): GraphRow[] {
  const lanes: (Lane | null)[] = [];
  const rows: GraphRow[] = [];
  const cache = new LineCache();

  const colorOf = (index: number): number =>
    lanes[index]?.isWorkingTree === true ? WORKING_TREE_COLOR : index;

  const freeSlot = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const isWorkingTree = commit.id === WIP_ID;
    const lines: GraphLine[] = [];
    const targets: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index]?.sha === commit.id) targets.push(index);
    }

    const nodeLane = targets[0] ?? freeSlot();
    const nodeColor = isWorkingTree ? WORKING_TREE_COLOR : nodeLane;
    let maxLane = nodeLane;

    // Nửa trên của hàng.
    for (let index = 0; index < lanes.length; index++) {
      const lane = lanes[index];
      if (!lane) continue;
      lines.push(cache.get(lane.sha === commit.id ? 'toNode' : 'pass', index, colorOf(index)));
      if (index > maxLane) maxLane = index;
    }
    for (const index of targets) lanes[index] = null;

    // Nửa dưới: nối tới các commit cha.
    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex++) {
      const parent = commit.parents[parentIndex];
      if (parent === undefined) continue;
      let slot: number;
      if (parentIndex === 0) {
        slot = nodeLane;
        lanes[slot] = { sha: parent, isWorkingTree };
      } else {
        const existing = lanes.findIndex((lane) => lane?.sha === parent);
        if (existing >= 0) {
          slot = existing;
        } else {
          slot = freeSlot();
          lanes[slot] = { sha: parent, isWorkingTree: false };
        }
      }
      lines.push(cache.get('fromNode', slot, colorOf(slot)));
      if (slot > maxLane) maxLane = slot;
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ lane: nodeLane, color: nodeColor, lines, width: maxLane + 1 });
  }
  return rows;
}
