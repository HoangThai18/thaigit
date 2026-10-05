// Lays commits out into graph lanes (port of GraphLayout.swift, same result). Pure functions, so this can run in a
// Web Worker.
//
// Input is commits already ordered children-before-parents (as `git log --date-order/--topo-order` gives). Each lane
// waits for one parent commit. A branch keeps its lane until it forks, then curves into its parent node (like
// GitKraken), which keeps straight lines uncrossed as much as possible. Colour follows the column (lane): lane 0 is
// always the same colour, adjacent lanes always differ, and colours do not jump around as history changes.

import { WORKING_TREE_ID, type Commit } from '../git/models.ts';

/** Colour of the dashed line from the WIP node to HEAD. */
export const WORKING_TREE_COLOR = -1;

export type GraphLineKind =
  /** Straight segment crossing the whole row in lane `lane`. */
  | 'pass'
  /** Upper half: from the lane top into the row's node. */
  | 'toNode'
  /** Lower half: from the node down to the lane bottom. */
  | 'fromNode';

/** One line segment to draw in a row. Immutable and shared between rows (structured clone preserves the sharing). */
export interface GraphLine {
  readonly kind: GraphLineKind;
  readonly lane: number;
  /** Colour index; `WORKING_TREE_COLOR` is the WIP dashed line. */
  readonly color: number;
}

export interface GraphRow {
  readonly lane: number;
  readonly color: number;
  readonly lines: readonly GraphLine[];
  /** Number of lanes this row needs. */
  readonly width: number;
}

/** The parts of a commit the layout needs. */
export type GraphCommit = Pick<Commit, 'id' | 'parents'>;

interface Lane {
  sha: string;
  /** Dashed line from the WIP node to HEAD. */
  isWorkingTree: boolean;
}

const KIND_INDEX: Record<GraphLineKind, number> = { pass: 0, toNode: 1, fromNode: 2 };

/** Read once: touching a module export inside a hot loop can be slow under a test module loader. */
const WIP_ID = WORKING_TREE_ID;

/** Tens of thousands of commits × tens of lanes → millions of segments, but only a few hundred distinct (kind, lane, colour) triples, so the objects are shared. */
class LineCache {
  private readonly lines = new Map<number, GraphLine>();

  get(kind: GraphLineKind, lane: number, color: number): GraphLine {
    // lane, colour + 1 stays under 2^20 for every real repo, so the key fits in a JS safe integer.
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

    // Upper half of the row.
    for (let index = 0; index < lanes.length; index++) {
      const lane = lanes[index];
      if (!lane) continue;
      lines.push(cache.get(lane.sha === commit.id ? 'toNode' : 'pass', index, colorOf(index)));
      if (index > maxLane) maxLane = index;
    }
    for (const index of targets) lanes[index] = null;

    // Lower half: connecting up to the parent commits.
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
