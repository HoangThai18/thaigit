/**
 * Chuỗi của tab repo trong một cửa sổ (thanh tab, phím tắt, menu). Truy cập qua `vi.tabs.*`.
 */
export const tabs = {
  label: 'Các repo đang mở',
  newTab: 'Tab mới',
  newTabShortcut: 'Ctrl/⌘ + T',
  newWindowShortcut: 'Ctrl/⌘ + Shift + N',
  welcomeTitle: 'Tab mới',
  closeTab: 'Đóng tab',
  closeTabShortcut: 'Ctrl/⌘ + W',
  closeOthers: 'Đóng các tab khác',
  closeNamed: (name: string) => `Đóng ${name}`,
  copyPath: 'Sao chép đường dẫn',
  pathLabel: 'đường dẫn',
  restoreFailed: (count: number) => `Không mở lại được ${count} repo từ lần trước`,
} as const;
