import type { AvatarImage } from './avatars.svelte.ts';
import { GraphStyle, laneColor, laneX } from './style.ts';

/** One line segment within a row (mirrors GraphLine.swift). */
export interface PaintLine {
  kind: 'pass' | 'toNode' | 'fromNode';
  lane: number;
  color: number;
}

/** Everything needed to paint one graph row. */
export interface PaintRow {
  lane: number;
  color: number;
  lines: readonly PaintLine[];
  isWorkingTree: boolean;
  isMerge: boolean;
  isHead: boolean;
  /** The row has branch/tag labels in the left column, so draw the connector from the left edge into the node. */
  hasLabels: boolean;
  /** Dimmed while a search is active and the row does not match. */
  dimmed: boolean;
  initials: string;
  /** Author email: the WIP row uses the current committer, every other row uses its commit author. */
  authorEmail: string;
}

export interface PaintTheme {
  laneColors: readonly string[];
  workingTreeColor: string;
  background: string;
  initialsColor: string;
  /** Avatar decoded per email; when missing the node draws initials instead. */
  avatar?: (email: string) => AvatarImage | null;
}

/**
 * Paint rows `first..<last` onto a canvas covering the Graph column (visible slice only, scaled by
 * devicePixelRatio). `offsetY` is the canvas y of the top of row `first` (negative when the first
 * visible row is scrolled part-way out).
 */
export function paintGraph(
  context: CanvasRenderingContext2D,
  rows: (index: number) => PaintRow | undefined,
  first: number,
  last: number,
  offsetY: number,
  theme: PaintTheme,
): void {
  const height = GraphStyle.rowHeight;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (let index = first; index < last; index++) {
    const row = rows(index);
    if (!row) continue;
    const top = offsetY + (index - first) * height;
    paintRowLines(context, row, top, theme);
  }
  // Nodes go last so neighbouring rows' lines cannot paint over them.
  for (let index = first; index < last; index++) {
    const row = rows(index);
    if (!row) continue;
    paintNode(context, row, offsetY + (index - first) * height, theme);
  }
  context.restore();
}

function paintRowLines(
  context: CanvasRenderingContext2D,
  row: PaintRow,
  top: number,
  theme: PaintTheme,
): void {
  const height = GraphStyle.rowHeight;
  const mid = top + Math.round(height / 2);
  const nodeX = laneX(row.lane);
  const alpha = row.dimmed ? 0.3 : 1;

  // Connector from the branch labels (left column) into the node.
  if (row.hasLabels) {
    context.globalAlpha = 0.55 * alpha;
    context.strokeStyle = laneColor(theme.laneColors, row.color, theme.workingTreeColor);
    context.lineWidth = 1.5;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(0, mid);
    context.lineTo(nodeX - GraphStyle.nodeRadius, mid);
    context.stroke();
  }

  for (const line of row.lines) {
    const color = laneColor(theme.laneColors, line.color, theme.workingTreeColor);
    const isWorkingTree = line.color === GraphStyle.workingTreeColor;
    const x = laneX(line.lane);
    const path = new Path2D();
    switch (line.kind) {
      case 'pass':
        path.moveTo(x, top);
        path.lineTo(x, top + height);
        break;
      case 'toNode':
        if (line.lane === row.lane) {
          path.moveTo(x, top);
          path.lineTo(x, mid);
        } else {
          // Straight down inside the lane, then a rounded corner turning horizontally into the node.
          const radius = Math.min(mid - top, Math.abs(nodeX - x));
          const direction = nodeX > x ? 1 : -1;
          path.moveTo(x, top);
          path.lineTo(x, mid - radius);
          path.quadraticCurveTo(x, mid, x + direction * radius, mid);
          path.lineTo(nodeX, mid);
        }
        break;
      case 'fromNode':
        if (line.lane === row.lane) {
          path.moveTo(x, mid);
          path.lineTo(x, top + height);
        } else {
          // Horizontally away from the node, then a rounded corner turning down into the parent lane.
          const radius = Math.min(top + height - mid, Math.abs(x - nodeX));
          const direction = x > nodeX ? 1 : -1;
          path.moveTo(nodeX, mid);
          path.lineTo(x - direction * radius, mid);
          path.quadraticCurveTo(x, mid, x, mid + radius);
          path.lineTo(x, top + height);
        }
        break;
    }
    context.strokeStyle = color;
    if (isWorkingTree) {
      context.setLineDash([3, 3]);
    } else {
      // Lens-like lane: a wide soft glow underneath the main stroke.
      context.setLineDash([]);
      context.globalAlpha = 0.16 * alpha;
      context.lineWidth = GraphStyle.lineWidth + 3;
      context.stroke(path);
    }
    context.globalAlpha = alpha;
    context.lineWidth = GraphStyle.lineWidth;
    context.stroke(path);
  }
  context.setLineDash([]);
  context.globalAlpha = 1;
}

function paintNode(context: CanvasRenderingContext2D, row: PaintRow, top: number, theme: PaintTheme): void {
  const mid = top + Math.round(GraphStyle.rowHeight / 2);
  const x = laneX(row.lane);
  const alpha = row.dimmed ? 0.3 : 1;
  const color = laneColor(theme.laneColors, row.color, theme.workingTreeColor);

  if (row.isWorkingTree) {
    const radius = GraphStyle.nodeRadius - 1;
    context.globalAlpha = alpha;
    context.fillStyle = theme.background;
    context.beginPath();
    context.arc(x, mid, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = theme.workingTreeColor;
    context.lineWidth = 1.6;
    context.setLineDash([2.5, 2]);
    context.stroke();
    context.setLineDash([]);
    // With an avatar the face already says "your work"; the dashed ring says "not committed". The pencil is the fallback.
    const avatar = theme.avatar?.(row.authorEmail) ?? null;
    if (avatar) {
      context.save();
      context.beginPath();
      context.arc(x, mid, radius - 2.5, 0, Math.PI * 2);
      context.clip();
      drawAvatarImage(context, avatar, x, mid, (radius - 2.5) * 2);
      context.restore();
    } else {
      // Small pencil: changes in progress.
      context.beginPath();
      context.moveTo(x - 3, mid + 3);
      context.lineTo(x + 3, mid - 3);
      context.stroke();
    }
    context.globalAlpha = 1;
    return;
  }

  const radius = row.isMerge ? GraphStyle.mergeNodeRadius + 0.5 : GraphStyle.nodeRadius;
  if (row.isHead && !row.isMerge) {
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = color;
    context.shadowBlur = 4;
    context.strokeStyle = color;
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(x, mid, radius + 3.5, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  const avatar = row.isMerge ? null : (theme.avatar?.(row.authorEmail) ?? null);
  if (avatar) {
    paintAvatarDisc(context, avatar, x, mid, radius, color, alpha);
  } else {
    paintGlassPearl(context, x, mid, radius, color, alpha);
  }
  if (!row.isMerge && !avatar) {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = theme.initialsColor;
    context.font = `700 ${row.initials.length > 1 ? 8 : 9}px -apple-system, 'Segoe UI', system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgb(0 0 0 / 0.35)';
    context.shadowBlur = 1;
    context.shadowOffsetY = 0.5;
    context.fillText(row.initials, x, mid + 0.5);
    context.restore();
  }
}

/** Draw a square image of `size`x`size` centred on (`x`, `y`), preserving aspect ratio — as GitKraken does. */
function drawAvatarImage(
  context: CanvasRenderingContext2D,
  image: AvatarImage,
  x: number,
  y: number,
  size: number,
): void {
  const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, x - width / 2, y - height / 2, width, height);
}

/** Circular avatar inside the lane's coloured ring (mirrors the Swift app's `drawAvatar`). */
function paintAvatarDisc(
  context: CanvasRenderingContext2D,
  image: AvatarImage,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  context.save();
  context.globalAlpha = alpha;
  context.shadowColor = 'rgb(0 0 0 / 0.28)';
  context.shadowBlur = 2.5;
  context.shadowOffsetY = 1;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = 'transparent';
  const inner = radius - 2;
  context.beginPath();
  context.arc(x, y, inner, 0, Math.PI * 2);
  context.clip();
  drawAvatarImage(context, image, x, y, inner * 2);
  context.restore();
}

/** Commit node as a "glass pearl" like the logo: darker towards the bottom, bright glass rim, specular highlight. */
function paintGlassPearl(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  context.save();
  context.globalAlpha = alpha;
  context.shadowColor = 'rgb(0 0 0 / 0.28)';
  context.shadowBlur = 2.5;
  context.shadowOffsetY = 1;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = 'transparent';

  const gradient = context.createLinearGradient(x, y - radius, x, y + radius);
  gradient.addColorStop(0, mix(color, '#ffffff', 0.42));
  gradient.addColorStop(0.5, color);
  gradient.addColorStop(1, mix(color, '#000000', 0.28));
  context.fillStyle = gradient;
  context.fill();

  context.strokeStyle = 'rgb(255 255 255 / 0.9)';
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(x, y, radius - 0.7, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = 'rgb(255 255 255 / 0.5)';
  context.beginPath();
  context.ellipse(x - radius * 0.06, y - radius * 0.48, radius * 0.4, radius * 0.26, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** Mix two #rrggbb hex colours by `amount` of the second one. */
export function mix(base: string, other: string, amount: number): string {
  const parse = (hex: string) => {
    const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff] as const;
  };
  const [r1, g1, b1] = parse(base);
  const [r2, g2, b2] = parse(other);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${channel(r1, r2)} ${channel(g1, g2)} ${channel(b1, b2)})`;
}
