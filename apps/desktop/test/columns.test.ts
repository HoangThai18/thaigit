import { describe, expect, it } from 'vitest';
import {
  COLUMN_LIMITS,
  DEFAULT_WIDTHS,
  MESSAGE_MIN,
  clampWidth,
  fitColumns,
  graphColumnWidth,
  sanitizePreferred,
} from '../src/lib/graph/columns.ts';

const GRAPH = 120;

describe('fitColumns', () => {
  it('đủ rộng: mọi cột hiện đúng độ rộng ưa thích, cột Commit lấp phần còn lại', () => {
    const layout = fitColumns(1000, DEFAULT_WIDTHS, GRAPH);
    expect(layout.visible).toEqual(['refs', 'graph', 'message', 'author', 'date', 'sha']);
    expect(layout.widths).toEqual({ refs: 190, graph: GRAPH, message: 364, author: 130, date: 122, sha: 74 });
  });

  it('tổng độ rộng các cột hiện luôn đúng bằng bề ngang (khi chưa tới mức tối thiểu)', () => {
    for (const available of [820, 900, 1234, 1920]) {
      const layout = fitColumns(available, DEFAULT_WIDTHS, GRAPH);
      const sum = layout.visible.reduce((total, id) => total + (layout.widths[id] ?? 0), 0);
      expect(sum).toBe(available);
    }
  });

  it('thiếu chỗ: co Tác giả → Thời gian → Nhánh/Tag tới mức tối thiểu, chưa ẩn gì', () => {
    const layout = fitColumns(700, DEFAULT_WIDTHS, GRAPH);
    expect(layout.visible).toContain('sha');
    expect(layout.widths.author).toBe(90);
    expect(layout.widths.date).toBe(116);
    expect(layout.widths.refs).toBe(140);
    expect(layout.widths.message).toBe(MESSAGE_MIN);
  });

  it('vẫn thiếu: ẩn SHA trước, rồi mới co tiếp', () => {
    const layout = fitColumns(600, DEFAULT_WIDTHS, GRAPH);
    expect(layout.visible).toEqual(['refs', 'graph', 'message', 'author', 'date']);
    expect(layout.widths).toMatchObject({ author: 90, date: 116, refs: 114, message: MESSAGE_MIN });
  });

  it('hẹp hơn: ẩn tiếp Thời gian, rồi Tác giả', () => {
    expect(fitColumns(400, DEFAULT_WIDTHS, GRAPH).visible).toEqual(['refs', 'graph', 'message']);
    expect(fitColumns(480, DEFAULT_WIDTHS, GRAPH).visible).toEqual(['refs', 'graph', 'message', 'author']);
  });

  it('cực hẹp: chỉ còn Nhánh/Tag (co tới mức tối thiểu), Graph, Commit — Commit giữ mức tối thiểu', () => {
    const layout = fitColumns(250, DEFAULT_WIDTHS, GRAPH);
    expect(layout.visible).toEqual(['refs', 'graph', 'message']);
    expect(layout.widths.refs).toBe(110);
    expect(layout.widths.message).toBe(MESSAGE_MIN);
  });

  it('rộng ra thì các cột đã ẩn hiện lại (không nhớ trạng thái ẩn)', () => {
    expect(fitColumns(400, DEFAULT_WIDTHS, GRAPH).visible).not.toContain('sha');
    expect(fitColumns(1200, DEFAULT_WIDTHS, GRAPH).visible).toContain('sha');
  });

  it('độ rộng ưa thích nhỏ hơn mức tối thiểu khi co thì không bị phình ra', () => {
    const layout = fitColumns(600, { ...DEFAULT_WIDTHS, author: 70 }, GRAPH);
    expect(layout.widths.author).toBe(70);
  });
});

describe('graphColumnWidth', () => {
  it('theo số làn, kẹp 64…640 và tối đa 40 làn', () => {
    expect(graphColumnWidth(1)).toBe(64);
    expect(graphColumnWidth(4)).toBe(96);
    expect(graphColumnWidth(5)).toBe(116);
    expect(graphColumnWidth(40)).toBe(640);
    expect(graphColumnWidth(500)).toBe(640);
  });
});

describe('sanitizePreferred / clampWidth', () => {
  it('thiếu hoặc rác → mặc định', () => {
    expect(sanitizePreferred(undefined)).toEqual(DEFAULT_WIDTHS);
    expect(sanitizePreferred('x')).toEqual(DEFAULT_WIDTHS);
    expect(sanitizePreferred({ refs: 'rộng', author: Number.NaN })).toEqual(DEFAULT_WIDTHS);
  });

  it('giá trị hợp lệ được giữ, ngoài khoảng thì kẹp', () => {
    const result = sanitizePreferred({ refs: 9999, author: 10, date: 150.4, sha: 100 });
    expect(result).toEqual({
      refs: COLUMN_LIMITS.refs.max,
      author: COLUMN_LIMITS.author.min,
      date: 150,
      sha: 100,
    });
    expect(clampWidth('sha', 1000)).toBe(160);
  });
});
