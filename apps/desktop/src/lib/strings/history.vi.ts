/**
 * Chuỗi của Lịch sử file và Blame (ai sửa từng dòng). Truy cập qua `vi.history.*`.
 */
export const history = {
  // Menu chuột phải của file
  menuFileHistory: 'Lịch sử file',
  menuBlame: 'Blame — ai sửa từng dòng',
  menuBlameAtCommit: 'Blame tại commit này',

  // Panel lịch sử file (bên phải)
  title: 'Lịch sử file',
  close: 'Đóng lịch sử file',
  loading: 'Đang đọc lịch sử…',
  loadFailed: 'Không đọc được lịch sử file',
  empty: 'File này chưa có trong commit nào.',
  commits: (count: number) => `${count} commit`,
  limited: (count: number) => `Chỉ hiện ${count} commit gần nhất.`,
  renamedFrom: (oldPath: string) => `đổi tên từ ${oldPath}`,
  deleted: 'đã xoá',
  added: 'tạo file',
  showInGraph: 'Xem trên graph',
  openDiff: 'Xem thay đổi của file',
  blameHere: 'Blame tại commit này',
  blameCurrent: 'Blame bản hiện tại',

  // Blame (vùng giữa)
  blameLabel: 'Blame',
  blameWorkingTree: 'Bản đang sửa',
  blameAtCommit: (sha: string) => `Tại ${sha}`,
  blameLoading: 'Đang tính ai sửa từng dòng…',
  blameFailed: 'Không blame được file này',
  blameEmpty: 'File trống.',
  blameRetry: 'Thử lại',
  uncommitted: 'Chưa commit',
  uncommittedTip: 'Dòng bạn đang sửa, chưa commit',
  lineTip: (sha: string, author: string, time: string, summary: string) =>
    `${sha} · ${author} · ${time}\n${summary}\nBấm để xem commit trên graph`,
  openHistory: 'Lịch sử file',
} as const;
