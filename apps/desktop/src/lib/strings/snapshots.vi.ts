/**
 * Chuỗi của Dòng thời gian (snapshot tự động của thư mục làm việc). Truy cập qua `vi.snapshots.*`.
 */
export const snapshots = {
  title: 'Dòng thời gian',
  open: 'Dòng thời gian…',
  openHint: 'Các bản Thaigit tự lưu thư mục làm việc — quay lại khi có gì hỏng',
  close: 'Đóng dòng thời gian',
  intro:
    'Thaigit tự lưu thư mục làm việc mỗi khi file thay đổi, kể cả file chưa commit. Chọn một mốc để xem khác gì so với bây giờ rồi khôi phục.',
  empty: 'Chưa có mốc nào. Thaigit sẽ tự lưu khi file trong repo thay đổi.',
  loading: 'Đang đọc dòng thời gian…',
  loadFailed: 'Không đọc được dòng thời gian',
  takeNow: 'Lưu mốc ngay',
  takeFailed: 'Không lưu được mốc',
  taken: 'Đã lưu mốc',

  disabledForRepo: 'Đang tắt tự lưu cho repo này.',
  enableForRepo: 'Bật lại',
  disableForRepo: 'Tắt tự lưu cho repo này',
  disabledGlobally: 'Tự lưu đang tắt trong Cài đặt.',

  reasonAuto: 'Tự lưu',
  reasonBeforeRestore: 'Trước khi khôi phục',
  reasonManual: 'Lưu tay',
  filesVsHead: (count: number) => `${count} file khác HEAD`,

  compareTitle: 'Khác với bây giờ',
  comparing: 'Đang so với bây giờ…',
  noDifference: 'Thư mục làm việc giống hệt mốc này.',
  restoreFile: 'Khôi phục file này',
  restoreAll: 'Khôi phục tất cả về mốc này',
  restoreConfirmTitle: (count: number) =>
    count === 1 ? 'Khôi phục 1 file về mốc này?' : `Khôi phục ${count} file về mốc này?`,
  restoreConfirmMessage:
    'Thư mục làm việc hiện tại được lưu thành một mốc trước khi ghi đè nên bạn hoàn tác được. File tạo sau mốc này được dời vào thùng rác của Thaigit. Phần đã stage không đổi.',
  restoreConfirm: 'Khôi phục',
  restoreTitle: 'Khôi phục từ dòng thời gian',
  restored: (count: number) => `Đã khôi phục ${count} file`,
  alreadySame: 'Thư mục làm việc đã giống mốc này.',
  undo: 'Hoàn tác',
  undoTitle: 'Hoàn tác khôi phục',
  undone: 'Đã đưa thư mục làm việc về như trước khi khôi phục',

  firstNotice:
    'Thaigit sẽ tự lưu thư mục làm việc khi file thay đổi để bạn quay lại được nếu code bị hỏng (Dòng thời gian, ở panel thay đổi). Mốc chỉ nằm trên máy, không bao giờ được push.',

  settingsTitle: 'Dòng thời gian',
  settingsEnabled: 'Tự lưu thư mục làm việc khi file thay đổi',
  settingsHelp:
    'Mốc nằm trong thư mục .git của từng repo (ref ẩn theo worktree), không bao giờ được push. Tắt riêng cho một repo ở panel Dòng thời gian.',
  keepDays: 'Giữ mốc trong (ngày)',
  keepCount: 'Số mốc tối đa mỗi repo',
} as const;
