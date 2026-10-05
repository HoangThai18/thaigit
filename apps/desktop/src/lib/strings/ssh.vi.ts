/**
 * The "SSH keys" entry in Settings — Thaigit's own SSH keys; the secrets live in the OS keychain.
 */
export const ssh = {
  title: 'Khoá SSH',
  help: 'Tạo khoá SSH ngay trong Thaigit (hoặc nhập khoá có sẵn) để clone / fetch / push repo SSH (git@github.com:…, git@gitlab.com:…) mà không cần cấu hình ssh-agent hay thư mục .ssh.',
  vaultHelp:
    'Khoá bí mật chỉ nằm trong kho bí mật của hệ điều hành trên máy này (Credential Manager trên Windows, Keychain trên macOS), không ghi ra file. Khi lệnh git cần, Thaigit nạp khoá vào một ssh-agent tạm riêng cho lệnh đó rồi tắt ngay.',
  empty: 'Chưa có khoá SSH nào.',
  generate: 'Tạo khoá mới',
  generateTitle: 'Tạo khoá SSH mới',
  generateMessage:
    'Khoá Ed25519 (loại GitHub và GitLab khuyên dùng). Đặt tên theo máy để dễ nhận ra trên GitHub / GitLab.',
  namePlaceholder: 'Tên khoá',
  import: 'Nhập khoá có sẵn…',
  copy: 'Sao chép khoá công khai',
  uploadTo: (login: string, host: string) => `Thêm lên ${host} @${login}`,
  rename: 'Đổi tên',
  renameTitle: 'Đổi tên khoá',
  remove: 'Xoá khoá',
  removeConfirm: (name: string) =>
    `Xoá khoá “${name}”? Khoá bí mật bị xoá vĩnh viễn khỏi máy và không khôi phục được — repo SSH đang dùng khoá này sẽ không fetch / push được nữa.`,
  encrypted: 'Có passphrase',
  encryptedHelp: 'Khoá có passphrase — Thaigit hỏi passphrase mỗi lần dùng',
  created: (date: string) => `Tạo ${date}`,
  enabled: 'Dùng khoá của Thaigit cho remote SSH',
  enabledHelp: 'Tắt thì git dùng ssh-agent và khoá trong thư mục .ssh như khi chạy ở terminal.',
  test: 'Kiểm tra kết nối',
  testing: 'Đang kiểm tra…',
  testOk: (host: string) => `Đã kết nối ${host} bằng khoá của Thaigit.`,
  testFailed: (host: string) =>
    `${host} chưa nhận khoá nào của Thaigit — hãy thêm khoá công khai lên tài khoản trước, hoặc kiểm tra mạng (cổng 22).`,
  generatedToast: (name: string) => `Đã tạo khoá “${name}”. Thêm khoá công khai lên GitHub / GitLab để dùng.`,
  importedToast: 'Đã nhập khoá vào kho bí mật của máy.',
  copiedToast: 'Đã sao chép khoá công khai.',
  removedToast: (name: string) =>
    `Đã xoá khoá “${name}”. Nhớ gỡ khoá công khai trên GitHub / GitLab nếu không dùng nữa.`,
  uploadedToast: (host: string) => `Đã thêm khoá lên ${host}.`,
  existsToast: (host: string) => `Khoá này đã có trên ${host}.`,
  missingScopeToast: (host: string) =>
    `Tài khoản ${host} chưa cấp quyền thêm khoá SSH cho Thaigit. Đã sao chép khoá và mở trang thêm khoá — dán khoá vào đó.`,
  errors: {
    invalid:
      'File này không phải khoá SSH bí mật mà Thaigit đọc được — hãy chọn file khoá bí mật (vd. id_ed25519), không phải file .pub.',
    duplicate: 'Khoá SSH này đã có trong Thaigit.',
    vault: 'Không mở được kho bí mật của hệ điều hành — hãy mở khoá rồi thử lại.',
    agent:
      'Không chạy được ssh-agent trên máy này (cần Git for Windows) nên chưa dùng được khoá SSH của Thaigit.',
  },
} as const;
