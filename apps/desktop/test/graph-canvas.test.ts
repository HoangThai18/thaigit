// Node graph: có avatar thì vẽ ảnh thay vì chữ viết tắt (kể cả node dòng WIP). Canvas thật không có trong
// vitest nên dùng context giả ghi lại lệnh vẽ — đủ để khẳng định node chọn đúng nhánh vẽ.
import { describe, expect, it } from 'vitest';
import { paintGraph, type PaintRow, type PaintTheme } from '../src/lib/graph/GraphCanvas.ts';

interface FakeContext {
  calls: string[];
  clip(): void;
}

function fakeContext(): FakeContext {
  const calls: string[] = [];
  const context = {
    calls,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => {},
    arc: () => calls.push('arc'),
    ellipse: () => calls.push('ellipse'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    clip: () => calls.push('clip'),
    moveTo: () => {},
    lineTo: () => {},
    fillText: () => calls.push('fillText'),
    drawImage: () => calls.push('drawImage'),
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  return context as unknown as FakeContext;
}

const row = (over: Partial<PaintRow> = {}): PaintRow => ({
  lane: 0,
  color: 0,
  lines: [],
  isWorkingTree: false,
  isMerge: false,
  isHead: false,
  hasLabels: false,
  dimmed: false,
  initials: 'PT',
  authorEmail: 'a@b.c',
  ...over,
});

const theme = (avatar?: PaintTheme['avatar']): PaintTheme => ({
  laneColors: ['#2f86e8'],
  workingTreeColor: '#8a93a3',
  background: '#ffffff',
  initialsColor: '#ffffff',
  ...(avatar ? { avatar } : {}),
});

const avatar = { naturalWidth: 80, naturalHeight: 80 } as unknown as HTMLImageElement;

function paint(row: PaintRow, paintTheme: PaintTheme): string[] {
  const context = fakeContext();
  paintGraph(context as unknown as CanvasRenderingContext2D, () => row, 0, 1, 0, paintTheme);
  return context.calls;
}

describe('paintGraph: avatar thay chữ viết tắt', () => {
  it('có avatar: vẽ ảnh, không vẽ chữ', () => {
    const calls = paint(
      row(),
      theme(() => avatar),
    );
    expect(calls).toContain('drawImage');
    expect(calls).not.toContain('fillText');
  });

  it('chưa có avatar: vẽ chữ viết tắt như cũ', () => {
    const calls = paint(
      row(),
      theme(() => null),
    );
    expect(calls).toContain('fillText');
    expect(calls).not.toContain('drawImage');
  });

  it('node WIP cũng vẽ avatar (email của người đang commit), không avatar thì vẽ bút chì', () => {
    expect(
      paint(
        row({ isWorkingTree: true }),
        theme(() => avatar),
      ),
    ).toContain('drawImage');
    expect(
      paint(
        row({ isWorkingTree: true }),
        theme(() => null),
      ),
    ).not.toContain('drawImage');
  });

  it('commit merge vẫn là nút tròn, không có avatar (không có mặt người để vẽ)', () => {
    const calls = paint(
      row({ isMerge: true }),
      theme(() => avatar),
    );
    expect(calls).not.toContain('drawImage');
    expect(calls).not.toContain('fillText');
  });

  it('hàng đang mờ (đang tìm kiếm) cũng mờ avatar theo', () => {
    const calls = paint(
      row({ dimmed: true }),
      theme(() => avatar),
    );
    expect(calls).toContain('drawImage');
  });
});
