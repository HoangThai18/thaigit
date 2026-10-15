/** Strings for the Issues area of the sidebar. Reached through `vi.issues.*`. */
export const issues = {
  section: 'ISSUES',
  empty: 'Không có issue nào đang mở.',
  notConnected: 'Repo chưa kết nối với máy chủ nào app nhận ra (GitHub / GitLab / Bitbucket).',
  noAccount: 'Chưa đăng nhập máy chủ này — thêm tài khoản ở Cài đặt → Tài khoản.',
  loading: 'Đang tải…',
  refresh: 'Tải lại',
  filterPlaceholder: 'Lọc issue…',
  noMatch: 'Không có issue nào khớp.',
  ref: (number: string) => `#${number}`,
  openOnWeb: 'Mở trên web',
  copyLink: 'Sao chép link',
  copyRef: 'Sao chép số issue',
  linkLabel: 'link issue',
  refLabel: 'số issue',
  createBranch: 'Tạo nhánh cho issue này…',
  tooltip: (ref: string, title: string, author: string, comments: number) =>
    `${ref} ${title}\nMở bởi ${author}${comments > 0 ? ` · ${comments} bình luận` : ''}`,
  assigned: (names: string) => `Gán cho: ${names}`,
} as const;
