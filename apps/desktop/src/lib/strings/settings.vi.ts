/**
 * Strings for the Settings screen and the usage question card. Reached through `vi.settings.*`.
 */
export const settings = {
  title: 'Cài đặt',
  open: 'Cài đặt…',
  shortcut: 'Ctrl/⌘ + ,',
  close: 'Xong',

  appearance: 'Giao diện',
  language: 'Ngôn ngữ / Language',
  languageHelp: 'Đổi ngôn ngữ thì cửa sổ tải lại để áp dụng; cửa sổ khác đổi theo khi mở lại.',
  scheme: 'Chế độ màu',
  schemeSystem: 'Theo hệ thống',
  schemeLight: 'Sáng',
  schemeDark: 'Tối',
  glass: 'Hiệu ứng kính (tắt nếu máy chậm)',
  relativeDates: 'Hiện thời gian tương đối ("5 phút trước")',

  history: 'Lịch sử',
  commitLimit: 'Số commit tải mỗi lần',
  logOrder: 'Thứ tự commit',
  logOrderDate: 'Theo thời gian',
  logOrderTopo: 'Theo nhánh (topo)',
  showRemoteBranches: 'Hiện nhánh remote trên graph',
  showTags: 'Hiện tag trên graph',

  sync: 'Đồng bộ',
  pullMode: 'Nút Pull dùng',
  pullMerge: 'Merge',
  pullRebase: 'Rebase',
  pullFastForward: 'Chỉ fast-forward',
  fetchPrune: 'Dọn nhánh remote đã bị xoá khi fetch (--prune)',
  /** Graph nodes draw the real avatar of each commit author. */
  showAvatars: 'Ảnh đại diện thật trên graph',
  showAvatarsTip: 'Tắt thì graph không tải ảnh nào, chỉ vẽ chữ cái đầu (tên người commit không rời máy)',
  autoFetch: 'Tự fetch mỗi (phút, 0 = tắt)',

  diff: 'Diff',
  diffContext: 'Số dòng ngữ cảnh quanh thay đổi',

  ai: 'AI viết commit',
  aiOn: 'Đang bật — bạn đã đồng ý gửi thay đổi đã lọc tới máy chủ Thaigit khi bấm nút AI.',
  aiOff: 'Chưa bật — lần đầu bấm "Viết bằng AI", Thaigit sẽ hỏi đồng ý trước khi gửi gì.',
  aiDisable: 'Tắt AI',
  aiLanguage: 'Ngôn ngữ mặc định',
  aiLength: 'Độ dài mặc định',
  aiConventional: 'Dùng Conventional Commits (feat:, fix:…)',

  privacy: 'Quyền riêng tư',
  telemetry: 'Gửi thống kê ẩn danh',
  telemetryHelp:
    'Mỗi ngày tối đa một lần: một mã ngẫu nhiên, hệ điều hành, kiến trúc máy và phiên bản Thaigit — để biết có bao nhiêu người đang dùng bản nào. Không gửi tên repo, đường dẫn, code hay email. Tắt là xoá mã.',
  telemetryUnsupported: 'Bản build này không gửi thống kê.',

  updates: 'Cập nhật',
  channel: 'Kênh cập nhật',
  channelBeta: 'Beta — nhận bản thử sớm',
  channelStable: 'Ổn định',
  channelFailed: 'Không đổi được kênh cập nhật',

  safety: 'An toàn',
  safetyHelp: 'Thaigit không tin repo lạ: mỗi lệnh git đều qua lớp kiểm tra trước khi chạy.',
  safetyAllowedCommands: (n: number) =>
    `Chỉ chạy đúng ${n} lệnh git Thaigit biết (không alias, không đường dẫn lạ).`,
  safetyForceSafeConfig:
    'Ép thêm `core.fsmonitor=false`, `core.hooksPath` trống và `protocol.file.allow=user`, `protocol.ext.allow=never` cho mọi lệnh.',
  safetyDiffNeverRunsRepoCode:
    'Lệnh xem diff (`diff`, `show`, `blame`, `log`…) luôn thêm `--no-ext-diff --no-textconv`: repo không chạy được chương trình nào từ cấu hình.',
  safetyUrlSchemesBlocked: (schemes: string) =>
    `Chặn các URL scheme ${schemes} — không clone / pull / push qua chương trình tuỳ ý.`,
  safetyEnvStripped:
    'Bỏ các biến môi trường git có thể trỏ sang repo (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`…) và chặn `-c` phía người gọi.',

  invalidNumber: (min: number, max: number) => `Nhập số từ ${min} đến ${max}`,

  askTitle: 'Giúp Thaigit tốt hơn?',
  askText:
    'Cho phép gửi thống kê ẩn danh (mỗi ngày một lần: mã ngẫu nhiên, hệ điều hành, phiên bản). Không gửi gì về repo hay code của bạn. Đổi lại được trong Cài đặt.',
  askYes: 'Đồng ý gửi',
  askNo: 'Không, cảm ơn',
} as const;
