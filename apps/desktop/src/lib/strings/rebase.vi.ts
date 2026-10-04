/**
 * Chuỗi của rebase tương tác (đổi thứ tự / sửa message / gộp / bỏ commit, như GitKraken). Truy cập qua `vi.rebase.*`.
 */
export const rebase = {
  menu: 'Rebase tương tác từ đây…',
  title: (branch: string) => `Rebase tương tác ${branch}`,
  subtitle: (count: number, sha: string, subject: string) =>
    `${count} commit sau ${sha} “${subject}”. Mới nhất ở trên cùng — kéo để đổi thứ tự.`,
  listLabel: 'Các commit sẽ được viết lại',
  actionLabel: (sha: string) => `Thao tác cho commit ${sha}`,
  actionPick: 'Pick — giữ nguyên',
  actionReword: 'Reword — sửa message',
  actionSquash: 'Squash — gộp, giữ message',
  actionFixup: 'Fixup — gộp, bỏ message',
  actionDrop: 'Drop — bỏ commit',
  squashInto: 'gộp vào commit bên dưới',
  messageLabel: (sha: string) => `Message mới cho ${sha}`,
  messageLoading: 'Đang đọc message…',
  dragHandle: 'Kéo để đổi thứ tự',
  moveUp: 'Chuyển lên trên',
  moveDown: 'Chuyển xuống dưới',
  keysHint: 'Phím tắt: P pick · R reword · S squash · F fixup · D drop · Alt + ↑ / ↓ để đổi chỗ',
  reset: 'Đặt lại',
  start: 'Bắt đầu rebase',
  cancel: 'Huỷ',

  problemEmpty: 'Không có commit nào để rebase.',
  problemMerge: 'Đoạn này có commit merge — Thaigit chưa hỗ trợ rebase tương tác qua commit merge.',
  problemLeadingSquash:
    'Commit dưới cùng không squash / fixup được vì bên dưới không còn commit nào để gộp vào.',
  problemEmptyMessage: 'Message mới không được để trống.',
  problemAllDropped: 'Không thể drop hết mọi commit — muốn đưa nhánh về commit gốc thì dùng Reset.',
  problemUnchanged: 'Chưa có thay đổi nào.',

  needBranch: 'Cần đứng trên một nhánh để rebase tương tác',
  operationInProgress: 'Repo đang có thao tác dở (merge, rebase…) — hãy tiếp tục hoặc huỷ thao tác đó trước.',
  notOnBranch: (sha: string) => `Commit ${sha} không nằm trên nhánh hiện tại nên không rebase từ đó được.`,
  nothingAfter: 'Không có commit nào sau commit này trên nhánh hiện tại.',
  loadFailed: 'Không đọc được các commit để rebase',
  running: (branch: string) => `Rebase tương tác ${branch}`,
  done: (branch: string) => `Đã rebase tương tác ${branch}`,
  autostashConflict:
    'Đã rebase xong, nhưng khi trả lại các thay đổi chưa commit thì bị xung đột — thay đổi của bạn vẫn còn nguyên trong stash.',
} as const;
