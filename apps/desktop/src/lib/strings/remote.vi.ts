/**
 * Chuỗi của phần remote: fetch / pull / push / tự fetch / thanh bận / thanh công cụ. Truy cập qua `vi.remote.*`. Văn phong
 * bám theo app Swift (RepoModel+Actions, RepoActionBar).
 */
export const remote = {
  // Thanh công cụ
  fetch: 'Fetch',
  fetchTip: 'Lấy thông tin mới từ mọi remote (Ctrl+Alt+F)',
  pull: 'Pull',
  pullBehind: (count: number) => `Pull ↓${count}`,
  pullTip: 'Kéo commit mới từ remote về nhánh hiện tại (Ctrl+Shift+L)',
  pullOptions: 'Kiểu pull khác',
  pullMerge: 'Pull (merge nếu cần)',
  pullRebase: 'Pull (rebase)',
  pullFastForward: 'Pull (chỉ fast-forward)',
  fetchOnly: 'Chỉ fetch',
  push: 'Push',
  pushAhead: (count: number) => `Push ↑${count}`,
  pushTip: 'Đẩy commit của nhánh hiện tại lên remote (Ctrl+Shift+P)',
  branch: 'Branch',
  branchTip: 'Tạo nhánh mới từ commit hiện tại (Ctrl+Shift+B)',
  stash: 'Stash',
  stashTip: 'Cất tạm mọi thay đổi chưa commit',
  pop: 'Pop',
  popTip: 'Lấy lại stash mới nhất',
  more: 'Thêm',
  refresh: 'Làm mới',
  commandLog: 'Nhật ký lệnh git…',
  switchBranchTip: 'Đổi nhánh',
  recentBranches: 'Nhánh gần đây',
  localBranches: 'Nhánh local',
  noBranches: 'Chưa có nhánh nào',
  newBranchHere: 'Nhánh mới…',

  // Thanh bận
  cancel: 'Huỷ',
  cancelTip: 'Dừng thao tác mạng đang chạy',

  // Fetch
  noRemote: 'Repository chưa có remote nào',
  fetched: 'Đã fetch xong',
  autoFetchFailed: 'Tự fetch không thành công',

  // Pull
  needBranchToPull: 'Cần đứng trên một nhánh để pull',
  noUpstream: (branch: string) => `Nhánh ${branch} chưa có nhánh tương ứng trên remote`,
  pushToRemote: 'Push lên remote',
  pulled: (branch: string) => `Đã pull về ${branch}`,
  upToDate: (branch: string) => `${branch} đã mới nhất`,
  undoPull: 'Hoàn tác pull',
  diverged: 'Nhánh local và remote đã tách nhau',
  pullWithMerge: 'Pull (merge)',
  pullWithRebase: 'Pull (rebase)',

  // Push
  needBranchToPush: 'Cần đứng trên một nhánh để push',
  pushTitle: (branch: string) => `Push ${branch}`,
  forcePushTitle: (branch: string) => `Force push ${branch}`,
  pushed: (branch: string, target: string) => `Đã push ${branch} → ${target}`,
  rejected: 'Push bị từ chối — remote có commit mà máy bạn chưa có',
  pullFirst: 'Pull trước',
  forcePush: 'Force push…',
  forcePushConfirmTitle: (branch: string) => `Force push ${branch}?`,
  forcePushConfirmMessage: (target: string) =>
    `Ghi đè ${target} bằng bản trên máy bạn (--force-with-lease: sẽ dừng nếu remote có commit mới mà bạn chưa fetch).`,
  forcePushConfirm: 'Force push',
  publishTitle: (branch: string) => `Push nhánh ${branch} lên remote`,
  publishMessage: 'Nhánh này chưa có nhánh tương ứng trên remote. Thaigit sẽ tạo nhánh trên remote và đặt làm upstream.',
  publishRemote: 'Remote',
  publishBranch: 'Tên nhánh trên remote',
  publishConfirm: 'Push',
  invalidRemoteBranch: 'Tên nhánh không hợp lệ',

  // Lỗi chung
  conflict: (operation: string) => `${operation} gặp xung đột`,
  conflictMessage: 'Mở các file xung đột ở panel bên phải để chọn bản giữ lại, rồi bấm “Tiếp tục”.',
  blockedByChanges: (operation: string) => `${operation} bị chặn vì có thay đổi chưa commit`,
  stashChanges: 'Stash thay đổi',
  authFailed: (operation: string) => `${operation} bị remote từ chối đăng nhập`,
  authFailedMessage:
    'Kiểm tra tài khoản / token của remote (Git Credential Manager trên Windows, Keychain trên macOS) rồi thử lại.',
  hostUnreachable: (operation: string) => `${operation}: không kết nối được tới remote`,

  // Hỏi đăng nhập (askpass)
  askpassUsernameTitle: (host: string | null) => (host ? `Đăng nhập ${host}` : 'Đăng nhập'),
  askpassUsernameLabel: 'Tên đăng nhập',
  askpassPasswordTitle: (host: string | null) => (host ? `Mật khẩu cho ${host}` : 'Mật khẩu'),
  askpassPasswordLabel: 'Mật khẩu hoặc token',
  askpassPassphraseTitle: 'Passphrase của khoá SSH',
  askpassPassphraseLabel: 'Passphrase',
  askpassOtherTitle: 'Git cần bạn xác nhận',
  askpassOtherLabel: 'Câu trả lời',
  askpassWaiting: (operation: string) => `${operation} đang chờ thông tin đăng nhập.`,
  askpassGithubToken: 'GitHub không nhận mật khẩu tài khoản — hãy dùng Personal access token.',
  askpassPrivacy: 'Thaigit chỉ chuyển câu trả lời cho git, không lưu lại.',
  askpassContinue: 'Tiếp tục',

  // Nhật ký lệnh
  commandLogTitle: 'Nhật ký lệnh git',
  commandLogEmpty: 'Chưa chạy lệnh nào.',
  commandLogClose: 'Đóng',
  commandLogCopy: 'Sao chép',
  commandLogCancelled: 'đã huỷ',
} as const;
