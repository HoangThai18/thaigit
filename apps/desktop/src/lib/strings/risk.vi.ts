/**
 * Strings for the risk warning strip on the changes panel. Reached through `vi.risk.*`.
 */
export const risk = {
  title: 'Nên xem lại trước khi commit',
  hint: 'Chỉ là cảnh báo — Thaigit không chặn commit.',
  dismiss: 'Ẩn cảnh báo này (hiện lại khi có cảnh báo mới)',
  testsRemoved: (count: number) => `Xoá ${count} file test`,
  testsSkipped: (count: number) => `Tắt bớt test (skip / only) trong ${count} file`,
  depsChanged: (count: number) => `Đổi dependency (${count} file)`,
  ciChanged: (count: number) => `Đổi CI / Docker (${count} file)`,
  largeFile: (count: number) => `${count} file lớn hơn 1 MB`,
  secret: (count: number) => `${count} file có thể chứa mật khẩu hoặc khoá bí mật`,
  more: (count: number) => `và ${count} file khác`,
} as const;
