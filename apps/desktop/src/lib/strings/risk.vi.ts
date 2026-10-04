/**
 * Chuỗi của dải cảnh báo rủi ro trên panel thay đổi. Truy cập qua `vi.risk.*`.
 */
export const risk = {
  title: 'Nên xem lại trước khi commit',
  hint: 'Chỉ là cảnh báo — Thaigit không chặn commit.',
  testsRemoved: (count: number) => `Xoá ${count} file test`,
  testsSkipped: (count: number) => `Tắt bớt test (skip / only) trong ${count} file`,
  depsChanged: (count: number) => `Đổi dependency (${count} file)`,
  ciChanged: (count: number) => `Đổi CI / Docker (${count} file)`,
  largeFile: (count: number) => `${count} file lớn hơn 1 MB`,
  secret: (count: number) => `${count} file có thể chứa mật khẩu hoặc khoá bí mật`,
  more: (count: number) => `và ${count} file khác`,
} as const;
