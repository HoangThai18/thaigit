/**
 * Strings for automatic updates. Reached through `vi.update.*`.
 */
export const update = {
  available: (version: string) => `Có Thaigit ${version}`,
  availableMessage: (current: string) => `Bạn đang dùng ${current}. Cập nhật xong app sẽ tự khởi động lại.`,
  installNow: 'Cập nhật ngay',
  later: 'Để sau',
  notes: 'Có gì mới',
  notesTitle: (version: string) => `Có gì mới trong ${version}`,
  checkNow: 'Kiểm tra cập nhật…',
  installMenu: (version: string) => `Cập nhật lên ${version}…`,
  checking: 'Đang kiểm tra cập nhật…',
  upToDate: (version: string) => `Bạn đang dùng bản mới nhất (${version})`,
  checkFailed: 'Không kiểm tra được bản cập nhật',
  installConfirmTitle: (version: string) => `Cập nhật lên Thaigit ${version}?`,
  installConfirmMessage:
    'Thaigit sẽ tải bản mới, xác minh chữ ký rồi cài và tự khởi động lại. Các repo đang mở sẽ được mở lại.',
  installConfirm: 'Cập nhật & khởi động lại',
  downloading: 'Đang tải bản cập nhật',
  verifying: 'Đang xác minh chữ ký',
  installing: 'Đang cài đặt',
  ready: 'Đã cài xong — đang khởi động lại',
  failed: 'Cập nhật không thành công',
  failedHint: 'Không tải hoặc cài được bản mới — kiểm tra kết nối mạng rồi thử lại.',
  retry: 'Thử lại',
  close: 'Đóng',
  progressBytes: (downloaded: string, total: string | null) =>
    total ? `${downloaded} / ${total}` : downloaded,
} as const;
