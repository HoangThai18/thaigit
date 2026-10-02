/**
 * Nhãn nhánh/tag ("pill") trên cột "Nhánh / Tag": gom ref theo commit (port `labelsByCommit` của RepoModel.swift), xếp chỗ
 * các viên trong độ rộng cột kèm "+N" khi tràn (port `RefsCellView.pillLayout`) và màu kính theo màu làn. Hàm thuần: chỉ
 * `measure` (đo chữ) do phía gọi đưa vào — giao diện dùng canvas, test dùng độ rộng giả.
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
  /** Số nhánh remote gộp vào nhãn này (nhánh local cùng tên/upstream → cùng một viên có biểu tượng đám mây). */
  readonly remoteCount: number;
  readonly isTag: boolean;
  readonly isDetachedHead: boolean;
  readonly refs: readonly GitRef[];
}

export interface LabelOptions {
  showRemotes: boolean;
  showTags: boolean;
}

function byName(a: GitRef, b: GitRef): number {
  const x = refName(a);
  const y = refName(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Thứ tự hiển thị: HEAD/nhánh hiện tại, rồi nhánh local, rồi remote, cuối cùng tag. */
function rank(label: RefLabel): number {
  if (label.isDetachedHead || label.isCurrentBranch) return 0;
  if (label.hasLocal) return 1;
  if (label.isTag) return 3;
  return 2;
}

/** Nhãn theo commit đích. Commit không có nhãn thì không có khoá trong kết quả. */
export function buildRefLabels(
  refs: readonly GitRef[],
  head: HeadState,
  options: LabelOptions,
): Map<string, RefLabel[]> {
  const remoteNames = new Set<string>();
  for (const ref of refs) {
    const remote = refRemoteName(ref);
    if (remote !== null) remoteNames.add(remote);
  }
  const singleRemote = remoteNames.size <= 1;
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
        if (refName(remote) === local.upstream || refShortBranchName(remote) === name) {
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
        const text = singleRemote ? refShortBranchName(remote) : refName(remote);
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

/** Chú thích hiện khi rê chuột vào nhãn (mỗi ref một dòng). */
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

// MARK: - Xếp chỗ

export const PILL = {
  height: 18,
  iconSize: 10,
  iconGap: 3,
  padding: 7,
  startX: 6,
  gap: 4,
  rightPadding: 4,
  moreWidth: 26,
  /** Chỗ chừa lại cho chip "+N" khi còn nhãn phía sau. */
  moreReserve: 30,
  /** Dưới ngưỡng này thì không vẽ thêm viên nào mà gộp vào "+N". */
  minAvailable: 44,
} as const;

export interface PillPlacement {
  index: number;
  x: number;
  width: number;
}

export interface PillLayout {
  pills: PillPlacement[];
  /** Chip "+N" khi tràn. */
  more: { x: number; count: number } | null;
  /** Mép phải của phần cuối cùng (đường nối sang cột graph bắt đầu từ đây). */
  end: number;
}

/**
 * Xếp các nhãn trong ô rộng `width`. `measure(text)` trả độ rộng chữ (px). Viên cuối có thể bị co lại (chữ cắt "…").
 * Luật như Swift: còn nhãn phía sau thì chừa 30px cho "+N"; chỗ trống < 44px thì dừng và hiện "+N" ở vị trí đó.
 */
export function layoutPills(
  labels: readonly RefLabel[],
  width: number,
  measure: (text: string) => number,
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
    const available = maxX - x - reserve;
    if (available < PILL.minAvailable) {
      layout.more = { x, count: labels.length - index };
      layout.end = x + PILL.moreWidth;
      return layout;
    }
    const pillWidth = Math.min(PILL.padding + iconsWidth + textWidth + PILL.padding, available);
    layout.pills.push({ index, x, width: pillWidth });
    layout.end = x + pillWidth;
    x = layout.end + PILL.gap;
  }
  return layout;
}

// MARK: - Màu

export interface PillAppearance {
  /** Màu nền trên/dưới (gradient dọc) đã gồm độ mờ. */
  top: string;
  bottom: string;
  /** Viền kính sáng bên trong. */
  rim: string;
  rimWidth: number;
  /** Viền màu mảnh bên ngoài. */
  edge: string;
}

const DETACHED_GRAY = parseHex('#8e8e93');

/** Màu kính của một viên theo màu làn (`laneHex`): remote-only nhạt hơn, HEAD tách rời xám, nhánh hiện tại đậm và viền sáng hơn. */
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
