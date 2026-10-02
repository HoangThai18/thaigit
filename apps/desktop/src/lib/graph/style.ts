/** Kích thước graph — giống GraphStyle.swift để hai bản trông như nhau. */
export const GraphStyle = {
  rowHeight: 30,
  laneWidth: 20,
  leftPadding: 8,
  lineWidth: 2,
  nodeRadius: 9.5,
  mergeNodeRadius: 5,
  /** Chỉ số màu đặc biệt của làn WIP (nét đứt), như `GraphLayout.workingTreeColor`. */
  workingTreeColor: -1,
} as const;

export function laneX(lane: number): number {
  return GraphStyle.leftPadding + lane * GraphStyle.laneWidth + GraphStyle.laneWidth / 2;
}

export function graphWidth(lanes: number): number {
  return GraphStyle.leftPadding * 2 + Math.max(lanes, 1) * GraphStyle.laneWidth;
}

/** Chữ cái đầu của tên ("Phan Thái" → "PT", "thai" → "TH") — như GraphStyle.initials. */
export function initials(name: string): string {
  const words = name.split(/[ ._-]+/u).filter((word) => word.length > 0);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  if (last) return (Array.from(first)[0] ?? '').toUpperCase() + (Array.from(last)[0] ?? '').toUpperCase();
  return Array.from(first).slice(0, 2).join('').toUpperCase();
}

/** Bảng 12 màu làn đọc từ token CSS (--lane-0 … --lane-11); làn i dùng màu i mod 12. */
export function readLaneColors(element: Element): string[] {
  const style = getComputedStyle(element);
  return Array.from(
    { length: 12 },
    (_, index) => style.getPropertyValue(`--lane-${index}`).trim() || '#2f86e8',
  );
}

export function laneColor(colors: readonly string[], index: number, workingTreeColor: string): string {
  if (index === GraphStyle.workingTreeColor) return workingTreeColor;
  const count = colors.length;
  return colors[((index % count) + count) % count] ?? workingTreeColor;
}
