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
  pullTip: 'Lấy commit mới từ remote về nhánh hiện tại (Ctrl+Shift+L)',
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

  // Repo thiếu nhánh / lịch sử của remote (clone --single-branch / --depth)
  historyGapsTitle: (missingBranches: boolean) =>
    missingBranches ? 'Repo chưa có đủ nhánh từ remote' : 'Repo chưa có đủ lịch sử từ remote',
  historyGapsNarrow: (remotes: readonly string[]) =>
    `Repo chỉ đang lấy một vài nhánh của ${remotes.join(', ')} nên các nhánh khác trên remote không hiện, kể cả khi Fetch.`,
  historyGapsShallow: 'Đây là shallow clone nên còn thiếu các commit cũ.',
  completeHistory: 'Lấy đầy đủ từ remote',
  completeHistoryTip: 'Theo dõi mọi nhánh của remote, tải các commit còn thiếu rồi fetch',
  historyCompleted: 'Đã lấy đủ nhánh và lịch sử từ remote',
  later: 'Để sau',

  // Pull
  needBranchToPull: 'Cần đứng trên một nhánh để pull',
  noUpstream: (branch: string) => `Nhánh ${branch} chưa có upstream trên remote`,
  pushToRemote: 'Push lên remote',
  pulled: (branch: string) => `Đã pull về ${branch}`,
  upToDate: (branch: string) => `${branch} đã mới nhất`,
  undoPull: 'Hoàn tác pull',
  diverged: 'Nhánh local và remote đã diverge',
  pullWithMerge: 'Pull (merge)',
  pullWithRebase: 'Pull (rebase)',

  // Push
  needBranchToPush: 'Cần đứng trên một nhánh để push',
  pushTitle: (branch: string) => `Push ${branch}`,
  forcePushTitle: (branch: string) => `Force push ${branch}`,
  pushed: (branch: string, target: string) => `Đã push ${branch} → ${target}`,
  rejected: 'Push bị từ chối — remote có commit mà máy bạn chưa có',
  pullFirst: 'Pull trước',
  pullThenPush: 'Pull rồi Push',
  syncBranch: 'Đồng bộ (pull rồi push)',
  forcePush: 'Force push…',
  forcePushConfirmTitle: (branch: string) => `Force push ${branch}?`,
  forcePushConfirmMessage: (target: string) =>
    `Ghi đè ${target} bằng bản trên máy bạn (--force-with-lease: sẽ dừng nếu remote có commit mới mà bạn chưa fetch).`,
  forcePushConfirm: 'Force push',
  publishTitle: (branch: string) => `Push nhánh ${branch} lên remote`,
  publishMessage: 'Nhánh này chưa có upstream. Thaigit sẽ tạo nhánh trên remote và đặt làm upstream.',
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
    'Kiểm tra tài khoản / token của remote (Cài đặt → Tài khoản, hoặc Git Credential Manager / Keychain) rồi thử lại.',
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

  // Quản lý remote (sidebar → REMOTE)
  addRemote: 'Thêm remote…',
  addRemoteTitle: 'Thêm remote',
  addRemoteMessage:
    'Remote là một bản của repo trên máy chủ (GitHub, GitLab…) hoặc thư mục khác để fetch / push.',
  remoteNameLabel: 'Tên',
  remoteUrlLabel: 'Địa chỉ (URL)',
  remoteNameRequired: 'Nhập tên remote',
  remoteNameInvalid:
    'Tên không hợp lệ (không dấu cách, không bắt đầu bằng “-”, không có ký tự ~ ^ : ? * [ \\)',
  remoteExists: (name: string) => `Đã có remote “${name}”`,
  remoteUrlRequired: 'Nhập địa chỉ của remote',
  fetchAfterAdd: 'Fetch ngay sau khi thêm',
  addRemoteRunning: (name: string) => `Thêm remote ${name}`,
  remoteAdded: (name: string) => `Đã thêm remote ${name}`,
  fetchRemote: (name: string) => `Fetch ${name}`,
  remoteFetched: (name: string) => `Đã fetch ${name}`,
  editRemoteUrl: 'Sửa địa chỉ…',
  editRemoteUrlTitle: (name: string) => `Địa chỉ của remote ${name}`,
  saveRemoteUrl: 'Lưu',
  editRemoteUrlRunning: (name: string) => `Đổi địa chỉ remote ${name}`,
  remoteUrlChanged: (name: string) => `Đã đổi địa chỉ remote ${name}`,
  renameRemote: 'Đổi tên…',
  renameRemoteTitle: (name: string) => `Đổi tên remote ${name}`,
  renameRemoteMessage: 'Các nhánh của remote và nhánh local đang theo dõi nó được đổi theo.',
  renameRemoteConfirm: 'Đổi tên',
  renameRemoteRunning: (name: string) => `Đổi tên remote ${name}`,
  remoteRenamed: (oldName: string, newName: string) => `Đã đổi remote ${oldName} → ${newName}`,
  removeRemote: 'Xoá remote…',
  removeRemoteTitle: (name: string) => `Xoá remote ${name}?`,
  removeRemoteMessage: (branches: number) =>
    branches > 0
      ? `Thaigit bỏ ${branches} nhánh remote khỏi máy bạn; các nhánh local đang theo dõi remote này không còn upstream. Repo trên máy chủ không bị đụng tới.`
      : 'Repo trên máy chủ không bị đụng tới.',
  removeRemoteConfirm: 'Xoá remote',
  removeRemoteRunning: (name: string) => `Xoá remote ${name}`,
  remoteRemoved: (name: string) => `Đã xoá remote ${name}`,
  undoRemoveRemote: 'Hoàn tác',
  remoteRestored: (name: string) => `Đã thêm lại remote ${name} — Fetch để thấy lại các nhánh của nó`,
  copyRemoteUrl: 'Sao chép địa chỉ',
  remoteUrlCopyLabel: 'địa chỉ',

  // Nhật ký lệnh
  commandLogTitle: 'Nhật ký lệnh git',
  commandLogEmpty: 'Chưa chạy lệnh nào.',
  commandLogClose: 'Đóng',
  commandLogCopy: 'Sao chép',
  commandLogCancelled: 'đã huỷ',
} as const;
