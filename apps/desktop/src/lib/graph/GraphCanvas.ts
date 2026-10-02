import { GraphStyle, laneColor, laneX } from './style.ts';

/** Một đoạn đường trong hàng (giống GraphLine.swift). */
export interface PaintLine {
  kind: 'pass' | 'toNode' | 'fromNode';
  lane: number;
  color: number;
}

/** Những gì cần để vẽ một hàng graph. */
export interface PaintRow {
  lane: number;
  color: number;
  lines: readonly PaintLine[];
  isWorkingTree: boolean;
  isMerge: boolean;
  isHead: boolean;
  /** Hàng có nhãn nhánh/tag ở cột trái → vẽ đường nối từ mép trái vào node. */
  hasLabels: boolean;
  /** Mờ đi khi đang tìm kiếm mà hàng không khớp. */
  dimmed: boolean;
  initials: string;
}

export interface PaintTheme {
  laneColors: readonly string[];
  workingTreeColor: string;
  background: string;
  initialsColor: string;
}

/**
 * Vẽ các hàng `first..<last` lên một canvas phủ cột Graph (chỉ phần đang thấy, theo devicePixelRatio).
 * `offsetY` là toạ độ đỉnh hàng `first` trong canvas (âm khi hàng đầu bị cuộn khuất một phần).
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
  // Node vẽ sau cùng để không bị đường của hàng kề đè lên.
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

  // Đường nối từ nhãn nhánh (cột bên trái) tới node.
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
          // Đi thẳng xuống trong làn rồi bo góc rẽ ngang vào node.
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
          // Đi ngang khỏi node rồi bo góc rẽ xuống làn của commit cha.
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
      // Làn như ống kính: một lớp sáng mờ rộng bên dưới nét chính.
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
    // Bút chì nhỏ: thay đổi đang làm.
    context.beginPath();
    context.moveTo(x - 3, mid + 3);
    context.lineTo(x + 3, mid - 3);
    context.stroke();
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
  paintGlassPearl(context, x, mid, radius, color, alpha);
  if (!row.isMerge) {
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

/** Node commit kiểu "viên ngọc kính" như logo: đậm dần xuống dưới, viền kính sáng, điểm phản chiếu. */
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

/** Trộn hai màu hex (#rrggbb) theo tỉ lệ `amount` của màu thứ hai. */
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
