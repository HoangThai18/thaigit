import { describe, expect, it } from 'vitest';
import { bundledNotes, inlineSegments, parseNotes } from '../src/lib/release/notes.ts';

describe('nhật ký "Có gì mới"', () => {
  it('tách mục theo phiên bản, ngày, đoạn văn và gạch đầu dòng nhiều dòng', () => {
    const sections = parseNotes(
      [
        '# Nhật ký',
        'Lời mở đầu bị bỏ qua.',
        '',
        '## Chưa phát hành',
        '',
        '- Mục mới',
        '',
        '## 2.6.5 — 2026-10-15',
        '',
        'Đoạn giới thiệu.',
        '- Sửa lỗi A',
        '  tiếp dòng',
        '- Sửa lỗi B',
      ].join('\n'),
    );
    expect(sections).toEqual([
      { title: 'Chưa phát hành', date: null, isUnreleased: true, paragraphs: [], items: ['Mục mới'] },
      {
        title: '2.6.5',
        date: '2026-10-15',
        isUnreleased: false,
        paragraphs: ['Đoạn giới thiệu.'],
        items: ['Sửa lỗi A tiếp dòng', 'Sửa lỗi B'],
      },
    ]);
  });

  it('chữ đậm, code và link thành đoạn văn bản thường', () => {
    expect(inlineSegments('Bấm **Push** rồi chạy `git log` ở [trang](https://x.vn).')).toEqual([
      { text: 'Bấm ', style: 'plain' },
      { text: 'Push', style: 'bold' },
      { text: ' rồi chạy ', style: 'plain' },
      { text: 'git log', style: 'code' },
      { text: ' ở trang.', style: 'plain' },
    ]);
  });

  it('nhật ký đóng gói kèm app có các phiên bản', () => {
    expect(bundledNotes.some((section) => section.title === '2.6.5')).toBe(true);
  });
});
