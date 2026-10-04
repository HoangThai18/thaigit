// Kiểm tên nhánh/tag hợp lệ ngay trong TS (không chạy git) theo `git check-ref-format`, để form nhập tên báo lỗi tức thì.
// `GitRepository.isValidRefName` vẫn hỏi git thật (nguồn sự thật); test đối chiếu hai bản trên một bộ tên.

/** Ký tự git cấm trong tên ref: ASCII điều khiển (< 0x20, 0x7f), khoảng trắng, `~ ^ : ? * [ \`. */
const FORBIDDEN_CHARACTERS = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Tên (phần sau `refs/heads/` hoặc `refs/tags/`) có hợp lệ không.
 * `branch` (mặc định): thêm luật của `git check-ref-format --branch` — không bắt đầu bằng `-`, không phải `HEAD`.
 * Khác git đúng một chỗ, có chủ ý: tag bắt đầu bằng `-` cũng bị từ chối (git cho qua nhưng `git tag -x` bị hiểu là cờ).
 */
export function isValidRefName(name: string, branch = true): boolean {
  if (name === '' || name.startsWith('-')) return false;
  if (branch && name === 'HEAD') return false;
  if (FORBIDDEN_CHARACTERS.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.endsWith('.')) return false;
  // Mỗi thành phần ngăn bởi "/": không rỗng (loại luôn "/" đầu/cuối và "//"), không mở đầu bằng ".", không kết thúc ".lock".
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * Tên remote hợp lệ: git đòi `refs/remotes/<tên>/x` là ref hợp lệ (`valid_remote_name`), tức cùng luật thành phần với tên tag —
 * kể cả cấm `-` ở đầu (không thì `git remote rename a -x` bị hiểu là cờ).
 */
export function isValidRemoteName(name: string): boolean {
  return isValidRefName(name, false);
}
