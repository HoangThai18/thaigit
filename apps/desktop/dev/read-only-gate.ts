/**
 * Cổng chỉ-đọc của cầu nối DEV: cầu nối này không bao giờ ghi vào repo, kể cả khi trình duyệt "khai" `kind: 'read'`.
 * Loại thao tác hiệu lực lấy từ `git-policy.json` (không tin `kind` do phía gọi gửi lên) — chính hàm `effectiveKind` mà
 * `GitRunner` và Rust (`derived_kind`) dùng, khớp theo TOÀN BỘ hình dạng args (`remote -v` là đọc, `remote -v add …` thì không).
 * NodeExec vẫn kiểm cờ/đối số theo chính sách trước khi chạy; cổng này chỉ thêm tầng "chỉ đọc".
 *
 * Chỉ import KIỂU từ `@thaigit/contracts`: file này nằm trong bundle của `vite.config.ts` (Node chạy trực tiếp), còn các package
 * workspace là TS nên giá trị (`effectiveKind`) do plugin nạp qua bộ nạp SSR của Vite rồi truyền vào (`KindOf`).
 */
import type { ExecKind } from '@thaigit/contracts';

/** `effectiveKind` của chính sách: loại hiệu lực của lệnh, `undefined` nếu subcommand không có trong chính sách. */
export type KindOf = (sub: string, args: readonly string[]) => ExecKind | undefined;

export type GateVerdict = { ok: true } | { ok: false; message: string };

/** Lệnh đọc có đối số là đường dẫn / revision: chặn đường dẫn ra ngoài repo (xem `isOutsideRepoPath`). */
const PATH_SCOPED = new Set(['diff', 'log', 'show']);

/**
 * Đường dẫn tuyệt đối (`/x`, `\x`, `C:\x`, `C:/x`) hoặc có đoạn `..` — cùng luật `is_outside_repo_path` của `policy.rs`.
 * Dạng `HEAD~1..HEAD` (`..` là một phần của đoạn) không bị tính.
 */
export function isOutsideRepoPath(arg: string): boolean {
  if (arg.startsWith('/') || arg.startsWith('\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(arg)) return true;
  return arg.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * `requested` là `kind` phía gọi gửi: `GitRunner` yêu cầu `write` cho `stash list` / `remote -v` (khoá chặt hơn mức cần),
 * điều đó vẫn hợp lệ; `network` thì luôn bị từ chối.
 */
export function checkReadOnly(
  kindOf: KindOf,
  requested: ExecKind,
  sub: string,
  args: readonly string[],
): GateVerdict {
  if (requested === 'network') return { ok: false, message: 'Cầu nối dev không chạy lệnh mạng.' };
  const effective = kindOf(sub, args);
  if (effective === undefined) return { ok: false, message: `Lệnh git ${sub} không có trong chính sách.` };
  if (effective === 'network') return { ok: false, message: 'Cầu nối dev không chạy lệnh mạng.' };
  if (effective === 'write') {
    return {
      ok: false,
      message: `Cầu nối dev chỉ đọc: từ chối "git ${[sub, ...args.slice(0, 2)].join(' ')}".`,
    };
  }

  // `diff --no-index` đọc được file bất kỳ trên máy: Rust chặn bằng lớp phạm vi đường dẫn, cầu nối dev thì từ chối hẳn.
  if (sub === 'diff' && args.some((arg) => arg === '--no-index')) {
    return { ok: false, message: 'Cầu nối dev không cho "diff --no-index".' };
  }
  // `diff <đường dẫn ngoài repo> <đường dẫn>` ngầm là `--no-index` (không cần cờ), và log/show nhận đường dẫn/revision: không
  // đối số nào (trước hay sau `--`) được trỏ ra ngoài repo.
  if (PATH_SCOPED.has(sub)) {
    let afterDashes = false;
    for (const arg of args) {
      if (!afterDashes && arg === '--') {
        afterDashes = true;
        continue;
      }
      if (!afterDashes && arg.startsWith('-') && arg.length > 1) continue;
      // `rev:đường-dẫn` (`show HEAD:/etc/hosts`): xét cả phần sau dấu `:` đầu tiên.
      if (
        isOutsideRepoPath(arg) ||
        (arg.includes(':') && isOutsideRepoPath(arg.slice(arg.indexOf(':') + 1)))
      ) {
        return { ok: false, message: `Cầu nối dev không cho "git ${sub}" đọc đường dẫn ngoài repo: ${arg}` };
      }
    }
  }
  return { ok: true };
}
