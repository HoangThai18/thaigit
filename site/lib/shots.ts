import type { Lang } from './i18n';

export const SHOTS = {
  conflict: {
    width: 1600,
    height: 931,
    alt: {
      vi: 'Trình giải xung đột: giữ Current, Incoming hoặc cả hai cho từng khối',
      en: 'Conflict resolver: keep Current, Incoming or both for each block',
    },
  },
  'diff-lines': {
    width: 1600,
    height: 931,
    alt: { vi: 'Chọn 3 dòng trong diff rồi bấm Stage dòng', en: 'Select 3 lines in the diff, then click Stage lines' },
  },
  'diff-split': {
    width: 1600,
    height: 931,
    alt: { vi: 'Diff tách đôi: trước và sau', en: 'Split diff: before and after' },
  },
  drag: {
    width: 1600,
    height: 931,
    alt: {
      vi: 'Thả nhánh feature/giao-dien lên main: chọn merge hoặc rebase',
      en: 'Drop the feature/giao-dien branch onto main: choose merge or rebase',
    },
  },
  'image-diff': {
    width: 1600,
    height: 931,
    alt: { vi: 'Diff ảnh: logo trước và sau khi đổi', en: 'Image diff: the logo before and after the change' },
  },
  large: {
    width: 1600,
    height: 931,
    alt: {
      vi: 'Repo 30.000 commit, gần 1.100 nhánh và tag',
      en: 'A repo with 30,000 commits and nearly 1,100 branches and tags',
    },
  },
  overview: {
    width: 1600,
    height: 931,
    alt: {
      vi: 'Thaigit: graph commit nhiều màu, sidebar nhánh và panel commit',
      en: 'Thaigit: a colorful commit graph, branch sidebar and commit panel',
    },
  },
  'overview-dark': {
    width: 1600,
    height: 931,
    alt: { vi: 'Thaigit giao diện tối', en: 'Thaigit in the dark theme' },
  },
  switch: {
    width: 1600,
    height: 931,
    alt: { vi: 'Hộp tìm và chuyển nhánh nhanh (⌘B)', en: 'Quick branch search and switch (⌘B)' },
  },
  welcome: {
    width: 1600,
    height: 931,
    alt: {
      vi: 'Màn hình chào: mở, clone, tạo repository',
      en: 'Welcome screen: open, clone or create a repository',
    },
  },
} as const satisfies Record<string, { width: number; height: number; alt: Record<Lang, string> }>;

export type ShotName = keyof typeof SHOTS;
