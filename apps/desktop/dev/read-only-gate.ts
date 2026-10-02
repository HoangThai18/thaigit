/**
 * Cổng chỉ-đọc của cầu nối DEV: cầu nối này không bao giờ ghi vào repo, kể cả khi trình duyệt "khai" `kind: 'read'`.
 * Loại thao tác hiệu lực lấy từ `git-policy.json` (không tin `kind` do phía gọi gửi lên) — cùng ý với `derived_kind`
 * của `src-tauri/src/policy.rs`. NodeExec vẫn kiểm cờ/đối số theo chính sách trước khi chạy; cổng này chỉ thêm tầng "chỉ đọc".
 *
 * Chỉ import KIỂU từ `@thaigit/contracts`: file này nằm trong bundle của `vite.config.ts` (Node chạy trực tiếp), còn các
 * package workspace là TS nên giá trị (`gitPolicy`) do plugin nạp qua bộ nạp SSR của Vite rồi truyền vào.
 */
import type { ExecKind, GitPolicy } from '@thaigit/contracts';

/**
 * Dạng chỉ-đọc của subcommand mà chính sách xếp `write` (khớp `READ_FORMS` trong policy.rs). `remote show` bị bỏ vì nó
 * liên lạc với máy chủ: cầu nối dev không chạy lệnh mạng.
 */
const READ_FORMS: Readonly<Record<string, readonly string[]>> = {
  stash: ['list', 'show'],
  remote: ['', '-v', '--verbose', 'get-url'],
};

export type GateVerdict = { ok: true } | { ok: false; message: string };

/**
 * `requested` là `kind` phía gọi gửi: `GitRunner` yêu cầu `write` cho `stash list` / `remote -v` (khoá chặt hơn mức cần),
 * điều đó vẫn hợp lệ; `network` thì luôn bị từ chối.
 */
export function checkReadOnly(
  policy: Pick<GitPolicy, 'subcommands'>,
  requested: ExecKind,
  sub: string,
  args: readonly string[],
): GateVerdict {
  if (requested === 'network') return { ok: false, message: 'Cầu nối dev không chạy lệnh mạng.' };
  const rule = Object.hasOwn(policy.subcommands, sub) ? policy.subcommands[sub] : undefined;
  if (!rule) return { ok: false, message: `Lệnh git ${sub} không có trong chính sách.` };
  if (rule.kind === 'network') return { ok: false, message: 'Cầu nối dev không chạy lệnh mạng.' };

  if (rule.kind === 'write') {
    const second = args[0] ?? '';
    const forms = Object.hasOwn(READ_FORMS, sub) ? READ_FORMS[sub] : undefined;
    if (!forms?.includes(second)) {
      return { ok: false, message: `Cầu nối dev chỉ đọc: từ chối "git ${sub} ${second}".` };
    }
    return { ok: true };
  }

  // `diff --no-index` đọc được file bất kỳ trên máy: Rust chặn bằng lớp phạm vi đường dẫn, cầu nối dev thì từ chối hẳn.
  if (sub === 'diff' && args.some((arg) => arg === '--no-index')) {
    return { ok: false, message: 'Cầu nối dev không cho "diff --no-index".' };
  }
  return { ok: true };
}
