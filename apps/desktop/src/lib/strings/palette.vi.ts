/**
 * Strings for the command palette (Ctrl/⌘ + P). Reached through `vi.palette.*`.
 */
export const palette = {
  title: 'Lệnh',
  open: 'Command palette…',
  shortcut: 'Ctrl/⌘ + P',
  placeholder: 'Gõ lệnh, tên nhánh, tag hoặc file…',
  hint: '↑↓ chọn · Enter chạy · Esc đóng',
  empty: 'Không có lệnh nào khớp',
  run: 'Chạy',
  pull: 'Pull (theo cài đặt)',
  checkoutBranch: (name: string) => `Checkout ${name}`,
  checkoutTag: (name: string) => `Checkout tag ${name}`,
  openDiff: (name: string) => `Xem diff: ${name}`,
  groupBranch: 'Nhánh',
  groupTag: 'Tag',
  groupFile: 'File',
} as const;
