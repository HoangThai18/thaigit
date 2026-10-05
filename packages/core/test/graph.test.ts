import { describe, expect, it } from 'vitest';
import { WORKING_TREE_ID, buildHistory, workingTreeCommit, type Commit } from '../src/git/index.ts';
import { WORKING_TREE_COLOR, computeGraphLayout, type GraphLine, type GraphRow } from '../src/graph/index.ts';

function commit(id: string, parents: string[] = []): Commit {
  return {
    id,
    parents,
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@x',
    commitDate: 0,
    subject: id,
  };
}

const line = (kind: GraphLine['kind'], lane: number, color: number): GraphLine => ({ kind, lane, color });

describe('Graph layout (port GraphLayoutTests.swift)', () => {
  it('linearHistoryStaysInOneLane', () => {
    const rows = computeGraphLayout([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(new Set(rows.map((row) => row.color)).size).toBe(1);
    expect(rows[0]?.lines).toEqual([line('fromNode', 0, 0)]);
    expect(rows[1]?.lines).toEqual([line('toNode', 0, 0), line('fromNode', 0, 0)]);
    expect(rows[2]?.lines).toEqual([line('toNode', 0, 0)]);
    expect(rows.every((row) => row.width === 1)).toBe(true);
  });

  it('mergeOpensSecondLaneAndJoinsAtForkPoint', () => {
    // M = merge(A, F); F sits on a feature branch that forked from A.
    const rows = computeGraphLayout([
      commit('M', ['A', 'F']),
      commit('F', ['A']),
      commit('A', ['R']),
      commit('R'),
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(rows[0]?.lines).toEqual([line('fromNode', 0, 0), line('fromNode', 1, 1)]);
    expect(rows[1]?.color).toBe(1);
    expect(rows[1]?.lines).toEqual([line('pass', 0, 0), line('toNode', 1, 1), line('fromNode', 1, 1)]);
    // A receives both lanes (the fork point), after which only one lane remains.
    expect(rows[2]?.lines).toEqual([line('toNode', 0, 0), line('toNode', 1, 1), line('fromNode', 0, 0)]);
    expect(rows[2]?.width).toBe(2);
    expect(rows[3]?.width).toBe(1);
  });

  it('colorsFollowLanes', () => {
    const rows = computeGraphLayout([
      commit('X', ['P']),
      commit('Y', ['P']),
      commit('Z', ['P']),
      commit('P'),
    ]);
    expect(rows.map((row) => row.color)).toEqual([0, 1, 2, 0]);
    for (const row of rows) for (const entry of row.lines) expect(entry.color).toBe(entry.lane);
  });

  it('siblingTipsGetSeparateLanes', () => {
    const rows = computeGraphLayout([commit('X', ['P']), commit('Y', ['P']), commit('P')]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
    expect(rows[1]?.color).not.toBe(rows[0]?.color);
    expect(rows[2]?.lines.filter((entry) => entry.kind === 'toNode').map((entry) => entry.lane)).toEqual([
      0, 1,
    ]);
  });

  it('reusesFreedLanes', () => {
    // Branch b ends (it meets a parent), then branch c opens again reusing the free lane.
    const rows = computeGraphLayout([
      commit('a2', ['a1']),
      commit('b1', ['a1']),
      commit('a1', ['a0']),
      commit('c1', ['a0']),
      commit('a0'),
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 1, 0]);
    expect(Math.max(...rows.map((row) => row.width))).toBe(2);
  });

  it('workingTreeRowIsDashedAndDoesNotShiftColors', () => {
    const withoutWip = computeGraphLayout([commit('h', ['g']), commit('g')]);
    const withWip = computeGraphLayout([workingTreeCommit('h'), commit('h', ['g']), commit('g')]);
    expect(withWip[0]?.color).toBe(WORKING_TREE_COLOR);
    expect(withWip[0]?.lines).toEqual([line('fromNode', 0, WORKING_TREE_COLOR)]);
    expect(withWip[1]?.lines[0]).toEqual(line('toNode', 0, WORKING_TREE_COLOR));
    expect(withWip[1]?.color).toBe(withoutWip[0]?.color);
    expect(withWip[2]?.color).toBe(withoutWip[1]?.color);
  });

  it('unbornWorkingTreeHasNoParentLine', () => {
    const rows = computeGraphLayout([workingTreeCommit(null)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lines).toEqual([]);
  });

  it('handlesThousandsOfCommitsQuickly', () => {
    const commits = syntheticHistory(5000);
    const start = performance.now();
    const rows = computeGraphLayout(commits);
    expect(rows).toHaveLength(commits.length);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('Graph layout: kiểm bổ sung', () => {
  it('30k commit xếp làn đủ nhanh (ngưỡng thô chống O(n²); mục tiêu 300 ms đo bằng `vitest bench`)', () => {
    const commits = syntheticHistory(30_000);
    const start = performance.now();
    const rows = computeGraphLayout(commits);
    const elapsed = performance.now() - start;
    expect(rows).toHaveLength(commits.length);
    expect(elapsed).toBeLessThan(1500);
  });

  it('khớp bản tham chiếu viết thẳng theo Swift trên lịch sử ngẫu nhiên (có merge, WIP, commit mồ côi)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const commits = randomHistory(seed, 400);
      expect(computeGraphLayout(commits)).toEqual(referenceLayout(commits));
    }
  });

  it('đối tượng đường dùng chung giữa các hàng, bất biến, và structuredClone giữ nguyên chia sẻ', () => {
    const rows = computeGraphLayout(syntheticHistory(300));
    const shared = rows[1]?.lines[0];
    expect(shared).toBeDefined();
    expect(Object.isFrozen(shared)).toBe(true);
    const distinct = new Set(rows.flatMap((row) => row.lines));
    expect(distinct.size).toBeLessThan(200);
    const cloned = structuredClone(rows);
    expect(new Set(cloned.flatMap((row) => row.lines)).size).toBe(distinct.size);
    expect(cloned).toEqual(rows);
  });

  it('buildHistory: parse + chèn WIP + layout, mayHaveMore theo giới hạn', () => {
    const log = new TextEncoder().encode(
      [
        ['2222222222', '1111111111', 'A', 'a@x', '20', 'A', 'a@x', '20', 'hai'],
        ['1111111111', '', 'A', 'a@x', '10', 'A', 'a@x', '10', 'một'],
      ]
        .map((fields) => `${fields.join('\u001f')}\0`)
        .join(''),
    );
    const history = buildHistory(log, { limit: 2, headOid: '2222222222', showWorkingTree: true });
    expect(history.loadedCount).toBe(2);
    expect(history.mayHaveMore).toBe(true);
    expect(history.commits).toHaveLength(3);
    expect(history.commits[0]?.id).toBe(WORKING_TREE_ID);
    expect(history.rows).toHaveLength(3);
    expect(history.rows[0]?.color).toBe(WORKING_TREE_COLOR);
    const withoutWip = buildHistory(log, { limit: 100, headOid: null, showWorkingTree: false });
    expect(withoutWip.commits).toHaveLength(2);
    expect(withoutWip.mayHaveMore).toBe(false);
    expect(
      buildHistory(new Uint8Array(0), { limit: 10, headOid: null, showWorkingTree: true }).commits,
    ).toHaveLength(1);
  });
});

/** Fake history shaped like `git log --date-order`: a linear main, with a side branch merged in every 50 commits. */
function syntheticHistory(count: number): Commit[] {
  const commits: Commit[] = [];
  for (let i = count; i > 0; i--) {
    const parents = i === 1 ? [] : i % 50 === 0 ? [`c${i - 1}`, `side${i}`] : [`c${i - 1}`];
    commits.push(commit(`c${i}`, parents));
    if (i % 50 === 0) commits.push(commit(`side${i}`, [`c${Math.max(i - 10, 1)}`]));
  }
  return commits;
}

/** Deterministic pseudo-random generator: a parent is always AFTER its children in the list, with the occasional root commit and WIP. */
function randomHistory(seed: number, count: number): Commit[] {
  let state = seed * 2654435761;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const ids = Array.from({ length: count }, (_, index) => `n${index}`);
  const commits: Commit[] = ids.map((id, index) => {
    const parents: string[] = [];
    const later = ids.slice(index + 1);
    if (later.length > 0 && random() < 0.95) {
      parents.push(later[Math.floor(random() * Math.min(later.length, 3))] ?? '');
      if (later.length > 1 && random() < 0.2) {
        const second = later[Math.floor(random() * Math.min(later.length, 8))] ?? '';
        if (second !== '' && !parents.includes(second)) parents.push(second);
      }
    }
    return commit(id, parents);
  });
  if (seed % 2 === 0) commits.unshift(workingTreeCommit(ids[0] ?? null));
  return commits;
}

/** A direct translation of GraphLayout.swift (no object sharing, no optimisation) used as a cross-check. */
function referenceLayout(commits: readonly Commit[]): GraphRow[] {
  type Lane = { sha: string; isWorkingTree: boolean } | null;
  const lanes: Lane[] = [];
  const rows: GraphRow[] = [];
  const color = (index: number) => (lanes[index]?.isWorkingTree === true ? WORKING_TREE_COLOR : index);
  const freeSlot = () => {
    const free = lanes.findIndex((lane) => lane === null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };
  for (const current of commits) {
    const isWorkingTree = current.id === WORKING_TREE_ID;
    const lines: GraphLine[] = [];
    const targets: number[] = [];
    lanes.forEach((lane, index) => {
      if (lane?.sha === current.id) targets.push(index);
    });
    const nodeLane = targets[0] ?? freeSlot();
    const nodeColor = isWorkingTree ? WORKING_TREE_COLOR : nodeLane;
    lanes.forEach((lane, index) => {
      if (!lane) return;
      lines.push({ kind: lane.sha === current.id ? 'toNode' : 'pass', lane: index, color: color(index) });
    });
    for (const index of targets) lanes[index] = null;
    current.parents.forEach((parent, parentIndex) => {
      if (parentIndex === 0) {
        lanes[nodeLane] = { sha: parent, isWorkingTree };
        lines.push({ kind: 'fromNode', lane: nodeLane, color: color(nodeLane) });
        return;
      }
      const existing = lanes.findIndex((lane) => lane?.sha === parent);
      if (existing >= 0) {
        lines.push({ kind: 'fromNode', lane: existing, color: color(existing) });
        return;
      }
      const slot = freeSlot();
      lanes[slot] = { sha: parent, isWorkingTree: false };
      lines.push({ kind: 'fromNode', lane: slot, color: color(slot) });
    });
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    const width =
      Math.max(lines.length > 0 ? Math.max(...lines.map((entry) => entry.lane)) : 0, nodeLane) + 1;
    rows.push({ lane: nodeLane, color: nodeColor, lines, width });
  }
  return rows;
}
