/**
 * Bộ biểu tượng nét (lưới 24×24) vẽ tay cho giao diện — thay SF Symbols của app Swift. Khai báo dạng dữ liệu (đường/hình
 * tròn/chữ nhật) để component dựng bằng `{#each}`: không bao giờ phải dùng `{@html}`.
 */
export type IconShape =
  | { d: string; fill?: boolean }
  | { circle: readonly [cx: number, cy: number, r: number]; fill?: boolean }
  | { rect: readonly [x: number, y: number, width: number, height: number, radius: number]; fill?: boolean };

const d = (path: string, fill = false): IconShape => ({ d: path, fill });
const circle = (cx: number, cy: number, r: number, fill = false): IconShape => ({
  circle: [cx, cy, r],
  fill,
});
const rect = (x: number, y: number, w: number, h: number, r: number): IconShape => ({
  rect: [x, y, w, h, r],
});

export const ICONS = {
  'chevron-right': [d('M9.5 6l6 6-6 6')],
  'chevron-down': [d('M6 9.5l6 6 6-6')],
  check: [d('M5 12.5l4.5 4.5L19 7.5')],
  plus: [d('M12 5v14M5 12h14')],
  x: [d('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  copy: [rect(9, 9, 11, 11, 2.2), d('M5.5 15V6.7A2.2 2.2 0 0 1 7.7 4.5H15')],
  search: [circle(10.8, 10.8, 6.3), d('M15.6 15.6l4.6 4.6')],
  filter: [d('M4 7.5h16M7 12h10M10 16.5h4')],
  folder: [d('M3.5 7.3A2 2 0 0 1 5.5 5.3h3.9l2.1 2.5h7a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z')],
  branch: [
    circle(6.5, 5.5, 2.3),
    circle(6.5, 18.5, 2.3),
    circle(17.5, 9, 2.3),
    d('M6.5 7.8v8.4M17.5 11.3c0 3.4-3.2 4.5-7 5.3'),
  ],
  laptop: [rect(5.2, 5, 13.6, 9.6, 1.8), d('M2.8 18.4h18.4')],
  cloud: [d('M7.4 18.6a4.4 4.4 0 0 1-.5-8.8 6 6 0 0 1 11.3 1.5 3.7 3.7 0 0 1-.7 7.3z')],
  tag: [
    d('M3.8 12.4V5.8a2 2 0 0 1 2-2h6.6l8 8a2 2 0 0 1 0 2.8l-6.3 6.3a2 2 0 0 1-2.8 0z'),
    circle(8.2, 8.2, 1.2, true),
  ],
  archive: [rect(3.2, 4, 17.6, 4.6, 1.2), d('M5 8.6v9.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.6M10 12.6h4')],
  'sidebar-left': [rect(3, 4.5, 18, 15, 2.6), d('M9.5 4.5v15')],
  'sidebar-right': [rect(3, 4.5, 18, 15, 2.6), d('M14.5 4.5v15')],
  warning: [d('M12 4.6l8.8 15.2H3.2z'), d('M12 10.2v4.1'), circle(12, 16.9, 0.55, true)],
  info: [circle(12, 12, 8.6), d('M12 11v5.4'), circle(12, 7.9, 0.6, true)],
  'check-circle': [circle(12, 12, 8.6), d('M8.2 12.3l2.6 2.6 5-5.4')],
  'x-circle': [circle(12, 12, 8.6), d('M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6')],
  shield: [
    d('M12 3.4l7.4 2.9v5.4c0 4.4-3 8-7.4 9.4-4.4-1.4-7.4-5-7.4-9.4V6.3z'),
    d('M12 8.4v4.2'),
    circle(12, 15.3, 0.55, true),
  ],
  'folder-open': [
    d(
      'M3.5 8.2v8.6a2 2 0 0 0 2 2h12.4a2 2 0 0 0 1.9-1.4l1.7-5.2a1.4 1.4 0 0 0-1.3-1.8H9.2L7.3 8H5.5a2 2 0 0 0-2 .2z',
    ),
  ],
  spinner: [d('M12 3.5a8.5 8.5 0 1 0 8.5 8.5')],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
