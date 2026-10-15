/**
 * Strings for the "Feedback & bug report" dialog. Reached through `vi.feedback.*`.
 */
export const feedback = {
  open: 'Góp ý & báo lỗi…',
  title: 'Góp ý & báo lỗi',
  intro: (email: string) =>
    `Thaigit mở ứng dụng email của bạn với thư soạn sẵn gửi tới ${email}. Bạn xem lại rồi tự bấm gửi — không có gì được gửi ngầm.`,
  kind: 'Loại',
  kindBug: 'Báo lỗi',
  kindIdea: 'Góp ý',
  message: 'Nội dung',
  placeholderBug: 'Bạn đang làm gì thì gặp lỗi? Lỗi hiện ra thế nào? Làm lại có bị nữa không?',
  placeholderIdea: 'Bạn muốn Thaigit có thêm gì, hoặc chỗ nào nên làm khác đi?',
  includeInfo: 'Kèm phiên bản Thaigit và hệ điều hành (giúp tìm lỗi nhanh hơn)',
  noRepoData: 'Thư không kèm tên repo, đường dẫn hay code của bạn.',
  infoVersion: (version: string) => `Phiên bản Thaigit: ${version}`,
  infoSystem: (system: string) => `Hệ điều hành: ${system}`,
  subject: (kind: 'bug' | 'idea') => (kind === 'bug' ? '[Thaigit] Báo lỗi' : '[Thaigit] Góp ý'),
  trimmed: '(Nội dung dài nên đã được cắt bớt — bạn dán phần còn lại vào thư nhé.)',
  send: 'Soạn email',
  copy: 'Chép nội dung',
  cancel: 'Huỷ',
  empty: 'Hãy viết vài dòng trước đã',
  opened: 'Đã mở ứng dụng email — kiểm tra lại rồi bấm gửi nhé',
  openFailed: (email: string) => `Không mở được ứng dụng email. Hãy chép nội dung rồi gửi tới ${email}`,
  copied: (email: string) => `Đã chép nội dung — dán vào thư gửi tới ${email}`,
  copyFailed: 'Không chép được nội dung',
} as const;
