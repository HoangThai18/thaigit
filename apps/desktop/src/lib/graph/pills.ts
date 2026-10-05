/**
 * Branch/tag labels ("pills") in the Branch/Tag column: grouped per commit (a port of `labelsByCommit` in
 * RepoModel.swift), laid out inside the column width with a "+N" chip on overflow (a port of
 * `RefsCellView.pillLayout`), tinted with glass colours derived from the lane colour. Pure: the only
 * impure input, `measure` (text measurement), is injected — the UI passes a canvas measurer, tests a fake.
 */
import {
  headBranchName,
  isAnnotatedTag,
  refName,
  refRemoteName,
  refShortBranchName,
  type GitRef,
  type HeadState,
} from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { BLACK, GRAY, WHITE, mixRgb, parseHex, rgbCss } from '../theme/color.ts';

export interface RefLabel {
  readonly key: string;
  readonly text: string;
  readonly isCurrentBranch: boolean;
  readonly hasLocal: boolean;
  /** Number of remote branches folded into this label (a local branch with the same name/upstream becomes one pill with a cloud icon). */
  readonly remoteCount: number;
  readonly isTag: boolean;
  readonly isDetachedHead: boolean;
  readonly refs: readonly GitRef[];
}

export interface LabelOptions {
  showRemotes: boolean;
  showTags: boolean;
  /** Names of the configured remotes: needed to detect remotes whose names contain `/` (`team/a`); absent means truncate at the first `/`. */
  remoteNames?: readonly string[];
}

function byName(a: GitRef, b: GitRef): number {
  const x = refName(a);
  const y = refName(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const MAIN_BRANCHES = new Set(['main', 'master', 'develop', 'dev']);

/**
 * Display order — the first label is the one still visible in a narrow cell (the rest fold into "+N"):
 * HEAD / current branch, then the main branch (main / master / develop), then other local branches,
 * remotes, and finally tags.
 */
function rank(label: RefLabel): number {
  if (label.isDetachedHead || label.isCurrentBranch) return 0;
  if (label.hasLocal && MAIN_BRANCHES.has(label.text)) return 1;
  if (label.hasLocal) return 2;
  if (label.isTag) return 4;
  return 3;
}

/** Labels keyed by target commit. A commit without labels gets no key in the result. */
export function buildRefLabels(
  refs: readonly GitRef[],
  head: HeadState,
  options: LabelOptions,
): Map<string, RefLabel[]> {
  const configured = options.remoteNames ?? [];
  const usedRemoteNames = new Set<string>();
  for (const ref of refs) {
    const remote = refRemoteName(ref, configured);
    if (remote !== null) usedRemoteNames.add(remote);
  }
  const singleRemote = usedRemoteNames.size <= 1;
  const current = headBranchName(head);

  const byTarget = new Map<string, GitRef[]>();
  for (const ref of refs) {
    const group = byTarget.get(ref.target);
    if (group) group.push(ref);
    else byTarget.set(ref.target, [ref]);
  }

  const result = new Map<string, RefLabel[]>();
  for (const [target, group] of byTarget) {
    const labels: RefLabel[] = [];
    const usedRemotes = new Set<string>();
    const remoteRefs = group.filter((ref) => ref.kind === 'remoteBranch').sort(byName);

    for (const local of group.filter((ref) => ref.kind === 'localBranch').sort(byName)) {
      const name = refName(local);
      const merged: GitRef[] = [local];
      for (const remote of remoteRefs) {
        if (usedRemotes.has(remote.fullName)) continue;
        if (refName(remote) === local.upstream || refShortBranchName(remote, configured) === name) {
          merged.push(remote);
          usedRemotes.add(remote.fullName);
        }
      }
      labels.push({
        key: `ref:${name}`,
        text: name,
        isCurrentBranch: name === current,
        hasLocal: true,
        remoteCount: merged.length - 1,
        isTag: false,
        isDetachedHead: false,
        refs: merged,
      });
    }
    if (options.showRemotes) {
      for (const remote of remoteRefs) {
        if (usedRemotes.has(remote.fullName)) continue;
        const text = singleRemote ? refShortBranchName(remote, configured) : refName(remote);
        labels.push({
          key: `ref:${text}`,
          text,
          isCurrentBranch: false,
          hasLocal: false,
          remoteCount: 1,
          isTag: false,
          isDetachedHead: false,
          refs: [remote],
        });
      }
    }
    if (options.showTags) {
      for (const tag of group.filter((ref) => ref.kind === 'tag').sort(byName)) {
        const text = refName(tag);
        labels.push({
          key: `tag:${text}`,
          text,
          isCurrentBranch: false,
          hasLocal: false,
          remoteCount: 0,
          isTag: true,
          isDetachedHead: false,
          refs: [tag],
        });
      }
    }
    labels.sort((a, b) => rank(a) - rank(b));
    if (labels.length > 0) result.set(target, labels);
  }

  if (head.kind === 'detached') {
    const detached: RefLabel = {
      key: 'head:detached',
      text: 'HEAD',
      isCurrentBranch: false,
      hasLocal: false,
      remoteCount: 0,
      isTag: false,
      isDetachedHead: true,
      refs: [],
    };
    result.set(head.oid, [detached, ...(result.get(head.oid) ?? [])]);
  }
  return result;
}

export type PillIcon = 'check' | 'laptop' | 'cloud' | 'tag' | 'warning';

export function pillIcons(label: RefLabel): PillIcon[] {
  if (label.isDetachedHead) return ['warning'];
  if (label.isTag) return ['tag'];
  const icons: PillIcon[] = [];
  if (label.isCurrentBranch) icons.push('check');
  if (label.hasLocal) icons.push('laptop');
  if (label.remoteCount > 0) icons.push('cloud');
  return icons;
}

/** Tooltip shown when hovering a label (one ref per line). */
export function pillTooltip(label: RefLabel): string {
  if (label.isDetachedHead) return vi.graph.detachedHeadPill;
  return label.refs
    .map((ref) => {
      switch (ref.kind) {
        case 'localBranch':
          return vi.graph.localBranchTip(refName(ref), ref.upstream);
        case 'remoteBranch':
          return vi.graph.remoteBranchTip(refName(ref));
        case 'tag':
          return isAnnotatedTag(ref) ? vi.graph.annotatedTagTip(refName(ref)) : vi.graph.tagTip(refName(ref));
      }
    })
    .join('\n');
}

// MARK: - Layout

export const PILL = {
  height: 18,
  iconSize: 10,
  iconGap: 3,
  padding: 7,
  startX: 6,
  gap: 4,
  rightPadding: 4,
  moreWidth: 26,
  /** Space kept for the "+N" chip while labels remain. */
  moreReserve: 30,
  /** Below this threshold no more pills are drawn; the rest fold into "+N". */
  minAvailable: 44,
  /** Gap between the branch name and the uncommitted file count badge. */
  badgeGap: 5,
  /** Horizontal padding of the badge (`.pill-badge` has `padding: 0 4px`) — must count towards the width or the branch name gets squeezed. */
  badgePadX: 4,
} as const;

export interface PillPlacement {
  index: number;
  x: number;
  width: number;
}

export interface PillLayout {
  pills: PillPlacement[];
  /** The "+N" chip used on overflow. */
  more: { x: number; count: number } | null;
  /** Right edge of the last element (the connector to the graph column starts here). */
  end: number;
}

/**
 * Lay out the labels inside a cell of width `width`. `measure(text)` returns the text width (px). The last
 * pill may be shrunk (text truncated with "…"). Same rules as Swift: while labels remain, reserve 30px for
 * "+N"; when the free space drops below 44px, stop and show "+N" at that position.
 *
 * With `pendingCount` > 0 the pill of the checked-out branch reserves extra room for the "✎ N" badge —
 * those uncommitted files belong to that branch, so the badge sits next to the branch name rather than on
 * the "// WIP" row.
 */
export function layoutPills(
  labels: readonly RefLabel[],
  width: number,
  measure: (text: string) => number,
  pendingCount = 0,
): PillLayout {
  const layout: PillLayout = { pills: [], more: null, end: PILL.startX };
  const maxX = width - PILL.rightPadding;
  let x: number = PILL.startX;
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    if (label === undefined) continue;
    const remaining = labels.length - index - 1;
    const reserve = remaining > 0 ? PILL.moreReserve : 0;
    const iconsWidth = pillIcons(label).length * (PILL.iconSize + PILL.iconGap);
    const textWidth = Math.ceil(measure(label.text));
    const badgeWidth = badgeExtra(label, pendingCount, measure);
    const available = maxX - x - reserve;
    if (available - badgeWidth < PILL.minAvailable) {
      layout.more = { x, count: labels.length - index };
      layout.end = x + PILL.moreWidth;
      return layout;
    }
    const pillWidth = Math.min(PILL.padding + iconsWidth + textWidth + badgeWidth + PILL.padding, available);
    layout.pills.push({ index, x, width: pillWidth });
    layout.end = x + pillWidth;
    x = layout.end + PILL.gap;
  }
  return layout;
}

/**
 * Extra room reserved for the "✎ N" badge — only for the pill of the checked-out branch. It includes the
 * flex `gap` before the badge plus the badge's horizontal padding: without both the branch name gets cut
 * to "m…" even when the column has room to spare.
 */
function badgeExtra(label: RefLabel, pendingCount: number, measure: (text: string) => number): number {
  if (!label.isCurrentBranch || pendingCount <= 0) return 0;
  return (
    PILL.iconGap + PILL.badgeGap + PILL.badgePadX * 2 + Math.ceil(measure(vi.graph.pillPending(pendingCount)))
  );
}

// MARK: - Colour

export interface PillAppearance {
  /** Top/bottom background colours (vertical gradient), alpha included. */
  top: string;
  bottom: string;
  /** Bright inner glass rim. */
  rim: string;
  rimWidth: number;
  /** Thin outer colour rim. */
  edge: string;
}

const DETACHED_GRAY = parseHex('#8e8e93');

/** Glass colours of a pill from its lane colour (`laneHex`): remote-only is lighter, detached HEAD is grey, the current branch is darker with a brighter rim. */
export function pillAppearance(label: RefLabel, laneHex: string, dimmed = false): PillAppearance {
  const lane = parseHex(laneHex);
  const fill = label.isDetachedHead
    ? DETACHED_GRAY
    : label.hasLocal || label.isTag
      ? lane
      : mixRgb(lane, GRAY, 0.35);
  const emphasized = label.isCurrentBranch;
  const opacity = (emphasized || label.isDetachedHead ? 1 : 0.88) * (dimmed ? 0.35 : 1);
  return {
    top: rgbCss(mixRgb(fill, WHITE, 0.3), opacity),
    bottom: rgbCss(mixRgb(fill, BLACK, 0.12), opacity),
    rim: rgbCss(WHITE, (emphasized ? 0.75 : 0.35) * opacity),
    rimWidth: emphasized ? 1.4 : 1,
    edge: rgbCss(mixRgb(fill, BLACK, 0.35), 0.45 * opacity),
  };
}
