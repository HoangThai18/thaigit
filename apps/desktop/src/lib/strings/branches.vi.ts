/**
 * Chuỗi của phần nhánh / tag / stash / merge-rebase / xung đột / menu ngữ cảnh. Truy cập qua `vi.branches.*`. Văn phong bám
 * theo app Swift (RepoModel+Actions).
 */
export const branches = {
  conflictPlaceholder: 'Trình giải xung đột sẽ có ở phase 5c.',

  // Checkout
  checkout: 'Checkout',
  checkoutTitle: (target: string) => `Checkout ${target}`,
  alreadyOn: (branch: string) => `Đang ở nhánh ${branch}`,
  switched: (branch: string) => `Đã chuyển sang nhánh ${branch}`,
  trackingCreated: (local: string, remote: string) => `Đã tạo nhánh ${local} theo dõi ${remote}`,
  tagLabel: (tag: string) => `tag ${tag}`,
  detachedConfirmTitle: (label: string) => `Checkout ${label}?`,
  detachedConfirmMessage:
    'Bạn sẽ ở chế độ “HEAD tách rời” (không thuộc nhánh nào). Muốn commit tiếp, hãy tạo nhánh mới tại đó.',
  detached: (label: string) => `Đang ở ${label} (HEAD tách rời)`,
  undoCheckout: 'Hoàn tác checkout',
  checkoutBlocked: 'Không checkout được vì có thay đổi chưa commit',
  stashAndCheckout: 'Stash rồi checkout',
  autoStashMessage: (title: string) => `Thaigit: tự cất trước khi ${title.toLowerCase()}`,
  doneWithStash: (title: string) => `${title} xong — thay đổi đã được cất vào stash`,
  popStash: 'Pop stash',

  // Tạo nhánh
  createTitle: 'Tạo nhánh mới',
  createTitleNamed: (name: string) => `Tạo nhánh ${name}`,
  createMessage: (start: string) => `Nhánh mới bắt đầu từ ${start}.`,
  create: 'Tạo nhánh',
  nameLabel: 'Tên nhánh',
  checkoutAfterCreate: 'Chuyển sang nhánh mới',
  nameRequired: 'Nhập tên nhánh',
  nameInvalid: 'Tên nhánh không hợp lệ (không dấu cách, không ~ ^ : ? * [ \\, không “..”)',
  nameExists: (name: string) => `Đã có nhánh ${name}`,
  needCommitFirst: 'Cần có ít nhất một commit trước khi tạo nhánh',
  created: (name: string) => `Đã tạo nhánh ${name}`,
  createdAndSwitched: (name: string) => `Đã tạo và chuyển sang nhánh ${name}`,
  deleteTitle: (name: string) => `Xoá nhánh ${name}`,

  // Stash
  stashTitle: 'Stash',
  stashed: 'Đã cất thay đổi vào stash',
  nothingToStash: 'Không có thay đổi nào để stash',
  noStash: 'Không có stash nào',
  popTitle: 'Pop stash',
  popped: 'Đã lấy lại thay đổi từ stash',
  stashKept: 'Stash vẫn được giữ lại vì có xung đột',
  applyStashTitle: 'Apply stash',
  stashApplied: (label: string) => `Đã áp dụng stash “${label}”`,
  dropStash: 'Xoá stash',
  dropStashConfirmTitle: (label: string) => `Xoá stash “${label}”?`,
  stashDropped: 'Đã xoá stash',
  restoreStash: 'Khôi phục stash',
  undoHint: 'Có thể bấm “Hoàn tác” ngay sau đó.',
} as const;
