/**
 * Chuỗi của phần stage / diff / commit / hoàn tác. Truy cập qua `vi.staging.*`. Văn phong bám theo app Swift (StagingView,
 * DiffPane, RepoModel+Actions).
 */
export const staging = {
  diffPlaceholder: 'Chọn một file để xem diff.',

  // Danh sách thay đổi
  unstagedTitle: 'Chưa stage',
  stagedTitle: 'Đã stage',
  conflictsTitle: 'Xung đột',
  stageAll: 'Stage tất cả',
  unstageAll: 'Bỏ stage tất cả',
  stageFile: 'Stage',
  unstageFile: 'Bỏ stage',
  discardFile: 'Huỷ thay đổi',
  noUnstaged: 'Không có thay đổi nào chưa stage',
  noStaged: 'Chưa stage file nào — bấm “Stage” hoặc “Stage tất cả”',
  clean: 'Không có thay đổi nào.',
  filesChanged: (count: number) => `${count} file thay đổi`,
  onBranch: (branch: string) => `trên ${branch}`,

  // Thao tác
  stageTitle: (count: number) => (count === 1 ? 'Stage file' : `Stage ${count} file`),
  unstageTitle: (count: number) => (count === 1 ? 'Bỏ stage file' : `Bỏ stage ${count} file`),
  stageAllTitle: 'Stage tất cả',
  unstageAllTitle: 'Bỏ stage tất cả',
  discardTitle: 'Huỷ thay đổi',
  discardConfirmTitle: (count: number, name: string) =>
    count === 1
      ? `Huỷ mọi thay đổi chưa stage của ${name}?`
      : `Huỷ mọi thay đổi chưa stage của ${count} file?`,
  discardConfirmMessage:
    'Thay đổi chưa stage sẽ bị bỏ; file mới (chưa track) được dời vào thùng rác của Thaigit. Có thể bấm “Hoàn tác” ngay sau đó.',
  discardConfirm: 'Huỷ thay đổi',
  discarded: (count: number) => (count === 1 ? 'Đã huỷ thay đổi' : `Đã huỷ thay đổi của ${count} file`),
  undo: 'Hoàn tác',
  undoTitle: 'Hoàn tác',
  undone: 'Đã hoàn tác',

  // Hunk / dòng
  stageHunk: 'Stage hunk',
  unstageHunk: 'Bỏ stage hunk',
  discardHunk: 'Huỷ hunk',
  stageLines: 'Stage dòng',
  unstageLines: 'Bỏ stage dòng',
  discardLines: 'Huỷ dòng',
  selectedLines: (count: number) => `Đã chọn ${count} dòng`,
  clearSelection: 'Bỏ chọn',
  lineTip: 'Bấm để chọn dòng này (stage / bỏ stage / huỷ từng dòng)',
  discardHunkConfirmTitle: 'Huỷ phần thay đổi đã chọn?',
  discardHunkConfirmMessage:
    'Những dòng đã chọn sẽ trở về như trong index. Có thể bấm “Hoàn tác” ngay sau đó.',
  partialUnsupported:
    'File này chỉ stage / bỏ stage được cả file (file nhị phân, chỉ đổi quyền, hoặc đổi tên).',

  // Diff
  diffLabel: 'Diff của file',
  back: 'Graph',
  backTip: 'Quay lại graph (Esc)',
  sourceUnstaged: 'Chưa stage',
  sourceStaged: 'Đã stage',
  sourceCommit: (sha: string) => `Commit ${sha}`,
  sourceStash: 'Stash',
  loading: 'Đang tải diff…',
  binary: 'File nhị phân — không hiển thị được nội dung.',
  layoutLabel: 'Bố cục diff',
  layoutUnified: 'Một cột',
  layoutSplit: 'Hai cột',
  listAsTree: 'Xem dạng cây thư mục',
  listAsPaths: 'Đang xem dạng cây — bấm để xem danh sách đường dẫn',
  stageFolder: 'Stage cả thư mục',
  unstageFolder: 'Bỏ stage cả thư mục',
  ignoreWhitespace: 'Bỏ qua khoảng trắng',
  ignoreWhitespaceTip:
    'Ẩn các thay đổi chỉ về khoảng trắng / thụt lề (git diff -w). Khi bật thì không stage / huỷ từng dòng được.',
  navLabel: 'Chuyển file — Alt + ↑ / ↓ để nhảy giữa các hunk',
  previousFile: 'File trước (Alt + Shift + ↑)',
  nextFile: 'File sau (Alt + Shift + ↓)',
  filePosition: (index: number, total: number) => `${index}/${total}`,
  imageOld: 'Bản cũ',
  imageNew: 'Bản mới',
  imageNone: 'Không có',
  imageTooLarge: 'Ảnh quá lớn để xem trước.',
  imageFailed: 'Không đọc được ảnh.',
  imageSize: (width: number, height: number, bytes: string) => `${width} × ${height} px · ${bytes}`,
  empty: 'Không có thay đổi nội dung (có thể chỉ đổi quyền file hoặc đổi tên).',
  emptyWhitespace: 'Chỉ có thay đổi về khoảng trắng — tắt “Bỏ qua khoảng trắng” để xem.',
  tooLargeTitle: 'Diff rất lớn',
  tooLargeMessage: (lines: number, additions: number, deletions: number) =>
    `${lines.toLocaleString('vi-VN')} dòng thay đổi (+${additions} −${deletions}). Hiển thị có thể chậm.`,
  showAnyway: 'Vẫn hiển thị',
  loadFailed: 'Không tải được diff',
  retry: 'Thử lại',

  // Commit
  commitTitle: 'Commit',
  summaryPlaceholder: 'Tóm tắt (bắt buộc)',
  bodyPlaceholder: 'Mô tả chi tiết (tuỳ chọn)',
  summaryTip: 'Nên giữ dòng tóm tắt dưới 72 ký tự',
  amend: 'Sửa commit trước (amend)',
  amendTip: 'Đưa thay đổi đã stage vào commit gần nhất và/hoặc sửa message của nó',
  commitButton: (count: number, branch: string) =>
    count > 0 ? `Commit ${count} file vào ${branch}` : 'Commit',
  amendButton: 'Sửa commit trước',
  stageAllAndCommit: 'Stage tất cả & commit',
  needSummary: 'Nhập tóm tắt để commit',
  needStaged: 'Stage thay đổi trước khi commit',
  conflictsFirst: (count: number) => `Giải quyết ${count} file xung đột trước khi commit`,
  committing: 'Commit',
  committed: (branch: string) => `Đã commit vào ${branch}`,
  amended: 'Đã sửa commit trước',
  commitShortcut: 'Ctrl/⌘ + Enter để commit',
  commitAndPush: 'Commit & Push',
  commitAndPushTip: 'Commit rồi push lên remote (Ctrl/⌘ + Shift + Enter)',
  undoCommit: 'Hoàn tác commit',
} as const;
