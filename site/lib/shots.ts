/** Ảnh giao diện trong public/screenshots (WebP 1600 & 800 px) — sinh bằng scripts/make-shots.py, đừng sửa tay. */
export const SHOTS = {
  'conflict': { width: 1600, height: 931, alt: 'Trình giải xung đột: giữ Current, Incoming hoặc cả hai cho từng khối' },
  'diff-lines': { width: 1600, height: 931, alt: 'Chọn 3 dòng trong diff rồi bấm Stage dòng' },
  'diff-split': { width: 1600, height: 931, alt: 'Diff tách đôi: trước và sau' },
  'drag': { width: 1600, height: 931, alt: 'Thả nhánh feature/giao-dien lên main: chọn merge hoặc rebase' },
  'image-diff': { width: 1600, height: 931, alt: 'Diff ảnh: logo trước và sau khi đổi' },
  'large': { width: 1600, height: 931, alt: 'Repo 30.000 commit, gần 1.100 nhánh và tag' },
  'overview': { width: 1600, height: 931, alt: 'Thaigit: graph commit nhiều màu, sidebar nhánh và panel commit' },
  'overview-dark': { width: 1600, height: 931, alt: 'Thaigit giao diện tối' },
  'switch': { width: 1600, height: 931, alt: 'Hộp tìm và chuyển nhánh nhanh (⌘B)' },
  'welcome': { width: 1600, height: 931, alt: 'Màn hình chào: mở, clone, tạo repository' },
} as const;

export type ShotName = keyof typeof SHOTS;
