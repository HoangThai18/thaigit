/**
 * Chuỗi của rebase tương tác (sắp xếp lại / sửa lời / gộp / bỏ commit, như GitKraken). Truy cập qua `vi.rebase.*`.
 */
export const rebase = {
  menu: 'Rebase tương tác từ đây…',
  title: (branch: string) => `Rebase tương tác ${branch}`,
  subtitle: (count: number, sha: string, subject: string) =>
    `${count} commit sau ${sha} “${subject}”. Mới nhất ở trên cùng — kéo để đổi thứ tự.`,
  listLabel: 'Các commit sẽ được viết lại',
  actionLabel: (sha: string) => `Việc làm với commit ${sha}`,
  actionPick: 'Giữ',
  actionReword: 'Sửa lời',
  actionSquash: 'Gộp, giữ lời',
  actionFixup: 'Gộp, bỏ lời',
  actionDrop: 'Bỏ',
  squashInto: 'gộp vào commit bên dưới',
  messageLabel: (sha: string) => `Lời commit mới cho ${sha}`,
  messageLoading: 'Đang đọc lời commit…',
  dragHandle: 'Kéo để đổi thứ tự',
  moveUp: 'Đưa lên (sau commit phía trên)',
  moveDown: 'Đưa xuống (trước commit phía dưới)',
  keysHint: 'Phím trên một hàng: P giữ · R sửa lời · S gộp · F gộp bỏ lời · D bỏ · Alt + ↑ / ↓ đổi chỗ',
  reset: 'Đặt lại',
  start: 'Bắt đầu rebase',
  cancel: 'Huỷ',

  problemEmpty: 'Không có commit nào để rebase.',
  problemMerge: 'Đoạn này có commit merge — Thaigit chưa hỗ trợ rebase tương tác qua commit merge.',
  problemLeadingSquash: 'Commit dưới cùng còn lại không gộp được (không có commit nào bên dưới để gộp vào).',
  problemEmptyMessage: 'Lời commit mới không được để trống.',
  problemAllDropped: 'Không thể bỏ hết mọi commit — dùng Reset nếu muốn đưa nhánh về commit gốc.',
  problemUnchanged: 'Chưa có thay đổi nào.',

  needBranch: 'Cần đứng trên một nhánh để rebase tương tác',
  operationInProgress: 'Repo đang có thao tác dở (merge, rebase…) — tiếp tục hoặc huỷ nó trước đã.',
  notOnBranch: (sha: string) => `Commit ${sha} không nằm trên nhánh hiện tại nên không rebase từ đó được.`,
  nothingAfter: 'Không có commit nào sau commit này trên nhánh hiện tại.',
  loadFailed: 'Không đọc được các commit để rebase',
  running: (branch: string) => `Rebase tương tác ${branch}`,
  done: (branch: string) => `Đã rebase tương tác ${branch}`,
  autostashConflict:
    'Đã rebase, nhưng trả lại thay đổi chưa commit bị xung đột — bản thay đổi của bạn vẫn nằm trong stash.',
} as const;
