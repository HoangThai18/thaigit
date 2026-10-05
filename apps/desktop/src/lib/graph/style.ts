import { stripBidi } from '../format/bidi.ts';

/** Graph metrics — kept identical to GraphStyle.swift so both apps look the same. */
export const GraphStyle = {
  rowHeight: 30,
  laneWidth: 20,
  leftPadding: 8,
  lineWidth: 2,
  nodeRadius: 9.5,
  mergeNodeRadius: 5,
  /** Colour index of the WIP lane (dashed stroke), like `GraphLayout.workingTreeColor`. */
  workingTreeColor: -1,
} as const;

export function laneX(lane: number): number {
  return GraphStyle.leftPadding + lane * GraphStyle.laneWidth + GraphStyle.laneWidth / 2;
}

export function graphWidth(lanes: number): number {
  return GraphStyle.leftPadding * 2 + Math.max(lanes, 1) * GraphStyle.laneWidth;
}

/** Initials from a name ("Phan Thái" → "PT", "thai" → "TH") — like GraphStyle.initials. */
export function initials(name: string): string {
  // Invisible bidi control characters (U+202E…) must not become the "first letter".
  const words = stripBidi(name)
    .split(/[ ._-]+/u)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  if (last) return (Array.from(first)[0] ?? '').toUpperCase() + (Array.from(last)[0] ?? '').toUpperCase();
  return Array.from(first).slice(0, 2).join('').toUpperCase();
}

/** Table of the 12 lane colours read from CSS tokens (--lane-0 … --lane-11); lane i uses colour i mod 12. */
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
