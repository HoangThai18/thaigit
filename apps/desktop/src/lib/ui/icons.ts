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

/** Thùng rác: dùng chung cho `discard` (huỷ thay đổi) và `trash` (xoá). */
const TRASH = [
  d('M4.5 7h15M9.5 7V5.2a1.4 1.4 0 0 1 1.4-1.4h2.2a1.4 1.4 0 0 1 1.4 1.4V7'),
  d('M6.6 7l.9 11.4a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8L17.4 7M10.2 11v5.6M13.8 11v5.6'),
] as const satisfies readonly IconShape[];

export const ICONS = {
  'chevron-right': [d('M9.5 6l6 6-6 6')],
  'chevron-left': [d('M14.5 6l-6 6 6 6')],
  'chevron-down': [d('M6 9.5l6 6 6-6')],
  'chevron-up': [d('M6 14.5l6-6 6 6')],
  check: [d('M5 12.5l4.5 4.5L19 7.5')],
  plus: [d('M12 5v14M5 12h14')],
  x: [d('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  copy: [rect(9, 9, 11, 11, 2.2), d('M5.5 15V6.7A2.2 2.2 0 0 1 7.7 4.5H15')],
  search: [circle(10.8, 10.8, 6.3), d('M15.6 15.6l4.6 4.6')],
  filter: [d('M4 7.5h16M7 12h10M10 16.5h4')],
  list: [
    d('M8.5 7h11M8.5 12h11M8.5 17h11'),
    circle(4.8, 7, 0.9, true),
    circle(4.8, 12, 0.9, true),
    circle(4.8, 17, 0.9, true),
  ],
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

  // --- Thao tác git (menu ngữ cảnh, thanh công cụ, hộp thoại) ---
  stage: [circle(12, 12, 8.6), d('M12 8.2v7.6M8.2 12h7.6')],
  unstage: [circle(12, 12, 8.6), d('M8.2 12h7.6')],
  discard: [...TRASH],
  trash: [...TRASH],
  commit: [circle(12, 12, 3.6), d('M3 12h5.4M15.6 12H21')],
  merge: [circle(6.5, 5.5, 2.3), circle(17.5, 17.5, 2.3), d('M6.5 7.8v13.2M6.5 11.5a6 6 0 0 0 6 6h2.7')],
  rebase: [
    circle(6.5, 5.5, 2.3),
    circle(6.5, 18.5, 2.3),
    circle(17.5, 18.5, 2.3),
    d('M6.5 7.8v8.4M17.5 16.2V10.5a3.5 3.5 0 0 0-3.5-3.5H11M12.8 4.9L10.7 7l2.1 2.1'),
  ],
  'cherry-pick': [
    circle(7.3, 17, 3),
    circle(16.7, 15.6, 3),
    d('M7.8 14C8.2 9.6 11 6.2 15.4 4.6M16.2 12.6c-.1-3.9-.5-6-1-8'),
    d('M15.4 4.6c2.1-.4 3.9.3 5 1.8'),
  ],
  revert: [d('M9 14.5L4.5 10 9 5.5'), d('M4.5 10h9a5.3 5.3 0 0 1 0 10.6H10.5')],
  undo: [d('M4 12a8 8 0 1 0 2.4-5.7'), d('M4 4.4v4.6h4.6')],
  reset: [d('M3.8 12a8.2 8.2 0 1 0 2.6-6'), d('M3.6 4.4v4.4h4.4'), d('M12 7.6V12l3 1.8')],
  checkout: [d('M15 14.5l4.5-4.5L15 5.5'), d('M19.5 10H10a5.3 5.3 0 0 0 0 10.6h3')],
  stash: [
    rect(3.2, 4, 17.6, 4.6, 1.2),
    d('M5 8.6v9.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.6M12 11.6v5M9.8 14.6l2.2 2.2 2.2-2.2'),
  ],
  push: [d('M12 17V5.5M7.2 10.2L12 5.5l4.8 4.7M5 20h14')],
  pull: [d('M12 5v11.5M7.2 11.8l4.8 4.7 4.8-4.7M5 20h14')],
  fetch: [
    d('M7.4 16.4a4.4 4.4 0 0 1-.5-8.8 6 6 0 0 1 11.3 1.5 3.7 3.7 0 0 1-.7 7.3'),
    d('M12 11v8M9.2 16.4l2.8 2.8 2.8-2.8'),
  ],
  'fast-forward': [d('M4.5 6.5l7 5.5-7 5.5zM12.5 6.5l7 5.5-7 5.5z')],
  compare: [d('M4 8h14M14.5 4.5L18 8l-3.5 3.5M20 16H6M9.5 12.5L6 16l3.5 3.5')],
  pencil: [
    d('M4.5 19.5l.9-4.2L16.7 4a1.9 1.9 0 0 1 2.7 0l.6.6a1.9 1.9 0 0 1 0 2.7L8.7 18.6z'),
    d('M14.8 5.9l3.3 3.3'),
  ],
  hash: [d('M9.5 4L8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5')],
  globe: [
    circle(12, 12, 8.6),
    d(
      'M3.4 12h17.2M12 3.4c2.3 2.4 3.4 5.3 3.4 8.6s-1.1 6.2-3.4 8.6c-2.3-2.4-3.4-5.3-3.4-8.6S9.7 5.8 12 3.4z',
    ),
  ],
  terminal: [rect(3, 4.5, 18, 15, 2.6), d('M7.5 9.5l3 2.5-3 2.5M13 15h3.5')],
  settings: [d('M4 7h9M17 7h3M4 17h3M11 17h9'), circle(15, 7, 2), circle(9, 17, 2)],
  download: [d('M12 4v10.5M7.5 10.2l4.5 4.5 4.5-4.5'), d('M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5')],
  more: [circle(6, 12, 1.2, true), circle(12, 12, 1.2, true), circle(18, 12, 1.2, true)],
  sparkles: [
    d('M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z'),
    d('M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'),
  ],
  stop: [rect(7, 7, 10, 10, 1.8)],
  clock: [circle(12, 12, 8.2), d('M12 7.4V12l3.2 2')],
  history: [d('M4.3 12a7.7 7.7 0 1 0 2.2-5.4'), d('M4.2 4.4v3.9h3.9'), d('M12 8v4.2l2.8 1.8')],
  blame: [circle(7, 8, 2.6), d('M3 17.6a4 4 0 0 1 8 0'), d('M14 7h6.5M14 12h6.5M14 17h4.5')],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
