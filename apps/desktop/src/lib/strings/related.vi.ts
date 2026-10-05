/**
 * Strings for worktrees and submodules (sidebar, menu, dialogs). Reached through `vi.related.*`.
 */
export const related = {
  // Sidebar
  worktrees: 'WORKTREES',
  submodules: 'SUBMODULES',
  worktreeCurrent: 'Worktree đang mở',
  worktreeMain: 'Worktree chính',
  worktreeDetached: (sha: string) => `detached HEAD @ ${sha}`,
  worktreeMissing: 'Thư mục không còn — dùng “Dọn worktree đã mất”',
  worktreeLocked: 'Đang bị khoá (git worktree lock)',
  noWorktrees: 'Chỉ có worktree chính',
  submoduleUninitialized: 'Chưa khởi tạo — chuột phải → Cập nhật',
  submoduleModified: 'Đang ở commit khác commit repo cha ghi nhận',
  submoduleConflict: 'Xung đột',

  // Menu
  openInNewWindow: 'Mở trong cửa sổ mới',
  copyPath: 'Sao chép đường dẫn',
  pathLabel: 'đường dẫn',
  addWorktree: 'Thêm worktree…',
  removeWorktree: 'Gỡ worktree…',
  pruneWorktrees: 'Dọn worktree đã mất',
  updateSubmodule: 'Cập nhật submodule này',
  updateAllSubmodules: 'Cập nhật tất cả submodule',
  syncSubmodules: 'Đồng bộ URL submodule (sync)',
  openFailed: 'Không mở được cửa sổ mới',

  // Add worktree
  addTitle: 'Thêm worktree',
  addMessage: (folder: string) =>
    `Worktree là một thư mục làm việc thứ hai của cùng repo, checkout một nhánh khác — làm song song mà không phải stash hay chuyển nhánh. Thư mục mới nằm trong ${folder}.`,
  branchLabel: 'Nhánh',
  createBranch: 'Tạo nhánh mới từ commit hiện tại',
  folderLabel: 'Tên thư mục',
  branchRequired: 'Nhập tên nhánh',
  branchInvalid: 'Tên nhánh không hợp lệ (không dấu cách, không ~ ^ : ? * [ \\, không “..”)',
  branchExists: (name: string) => `Đã có nhánh ${name} — bỏ chọn “Tạo nhánh mới” để dùng nhánh này`,
  branchMissing: (name: string) => `Chưa có nhánh ${name} — chọn “Tạo nhánh mới”`,
  branchCheckedOut: (name: string) => `Nhánh ${name} đang được checkout ở một worktree khác`,
  folderRequired: 'Nhập tên thư mục',
  folderInvalid: 'Tên thư mục không được chứa / \\ : * ? " < > | và không được là . hoặc ..',
  addConfirm: 'Thêm worktree',
  addRunning: (branch: string) => `Thêm worktree cho ${branch}`,
  added: (branch: string) => `Đã thêm worktree cho ${branch}`,

  // Remove / clean
  removeConfirmTitle: (name: string) => `Gỡ worktree ${name}?`,
  removeConfirmMessage:
    'Thư mục của worktree sẽ bị xoá; nhánh và các commit vẫn giữ nguyên trong repo. Git sẽ từ chối nếu worktree còn thay đổi chưa commit.',
  removeConfirm: 'Gỡ worktree',
  removeRunning: (name: string) => `Gỡ worktree ${name}`,
  removed: (name: string) => `Đã gỡ worktree ${name}`,
  removeDirty: (name: string) => `Worktree ${name} còn thay đổi chưa commit`,
  forceRemoveTitle: (name: string) => `Vẫn gỡ worktree ${name}?`,
  forceRemoveMessage: 'Mọi thay đổi chưa commit trong worktree này sẽ MẤT VĨNH VIỄN.',
  forceRemove: 'Vẫn gỡ',
  pruneRunning: 'Dọn worktree đã mất',
  pruned: 'Đã dọn các worktree không còn thư mục',

  // Submodule
  updateRunning: (count: number | null) =>
    count === null ? 'Cập nhật submodule' : `Cập nhật ${count} submodule`,
  updated: 'Đã cập nhật submodule',
  syncRunning: 'Đồng bộ URL submodule',
  synced: 'Đã đồng bộ URL submodule',
} as const;
