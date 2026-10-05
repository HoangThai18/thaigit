/**
 * Strings for Git LFS (sidebar, file menu, dialogs). Reached through `vi.lfs.*`.
 */
export const lfs = {
  // Sidebar
  section: 'GIT LFS',
  notInstalled: 'Máy chưa cài Git LFS — các file LFS chỉ là con trỏ',
  lockable: 'Phải khoá trước khi sửa (lockable)',
  patternTitle: (pattern: string) => `File khớp ${pattern} được lưu bằng Git LFS`,

  // Menu
  more: 'Thao tác Git LFS',
  track: 'Track mẫu mới bằng LFS…',
  untrack: 'Bỏ track bằng LFS',
  fetch: 'Fetch file LFS',
  pull: 'Pull file LFS',
  prune: 'Dọn bộ nhớ đệm LFS (prune)',
  fileMenu: 'Git LFS',
  trackExtension: (extension: string) => `Track mọi file .${extension} bằng LFS`,
  trackFile: 'Track riêng file này bằng LFS',

  // Dialog
  trackTitle: 'Track bằng Git LFS',
  trackMessage:
    'File khớp mẫu sẽ được lưu trên máy chủ LFS, trong repo chỉ còn con trỏ nhỏ. Mẫu được ghi vào .gitattributes — nhớ commit file này. File đã commit trước đó không tự chuyển sang LFS.',
  patternLabel: 'Mẫu (vd. *.psd, assets/**)',
  patternRequired: 'Nhập mẫu file',
  patternInvalid: 'Mẫu không được bắt đầu bằng - hay chứa xuống dòng',
  trackConfirm: 'Track',

  // Run
  trackRunning: (pattern: string) => `Track ${pattern} bằng LFS`,
  tracked: (pattern: string) => `Đã track ${pattern} bằng LFS — nhớ commit .gitattributes`,
  untrackRunning: (pattern: string) => `Bỏ track ${pattern}`,
  untracked: (pattern: string) => `Đã bỏ track ${pattern} — nhớ commit .gitattributes`,
  fetchRunning: 'Fetch file LFS',
  fetched: 'Đã fetch file LFS',
  pullRunning: 'Pull file LFS',
  pulled: 'Đã pull file LFS về working tree',
  pruneRunning: 'Dọn bộ nhớ đệm LFS',
  pruned: 'Đã dọn bộ nhớ đệm LFS',

  // Diff
  pointerTitle: 'File Git LFS',
  pointerMessage: (size: string) =>
    `Trong git, file này chỉ là con trỏ tới nội dung ${size} lưu trên máy chủ LFS.`,
} as const;
