import policyJson from '../git-policy.json' with { type: 'json' };

/** Loại thao tác: quyết định khoá theo repo (`write`/`network` độc quyền) và cách huỷ (chỉ `network`). */
export type ExecKind = 'read' | 'write' | 'network';

/** Hồ sơ môi trường: `background` (tự fetch) không bao giờ bật hộp thoại đăng nhập. */
export type EnvProfile = 'interactive' | 'background';

/**
 * Dạng chỉ-đọc của một subcommand `write`: khớp khi args BẮT ĐẦU bằng đúng dãy `args` và, trừ khi `rest`, không còn đối số nào
 * sau đó (`remote -v` là dạng chỉ-đọc, `remote -v update` thì không).
 */
export interface ReadForm {
  args: string[];
  /** Cho phép thêm đối số tuỳ ý sau `args` (vd. `stash list --format=…`, `remote get-url origin`). */
  rest?: boolean;
}

export interface SubcommandRule {
  kind: ExecKind;
  allowShort?: string[];
  allowLong?: string[];
  allowSecond?: string[];
  typedSecond?: string[];
  rejectSecond?: string[];
  /** Đối số đầu thuộc danh sách này phải là đối số DUY NHẤT (`remote -v` ok, `remote -v add …` bị chặn). */
  aloneSecond?: string[];
  readForms?: ReadForm[];
  requireAny?: string[];
  rejectExtraLong?: string[];
  rejectExtraShort?: string[];
  urls?: boolean;
}

export interface GitPolicy {
  version: number;
  globalConfig: string[];
  diffSafety: { args: string[]; after: string[][] };
  env: {
    set: Record<string, string>;
    setIfMissing: Record<string, string>;
    remove: string[];
    removePrefixes: string[];
    fromCaller: Record<string, { values?: string[]; pathInside?: 'gitDir' }>;
    profiles: Record<EnvProfile, Record<string, string>>;
    pathFallback: { macos: string[]; windows: string[] };
  };
  rejectLong: string[];
  rejectShort: string[];
  shortAttached: string[];
  url: { rejectPrefixes: string[]; rejectSchemes: string[] };
  subcommands: Record<string, SubcommandRule>;
  typedOnly: Record<string, string>;
  configSetAllowlist: string[];
  networkKinds: string[];
}

export const gitPolicy: GitPolicy = policyJson as GitPolicy;

/** `args` khớp TOÀN BỘ hình dạng của một dạng chỉ-đọc (`readForms`) của `rule`? */
export function matchesReadForm(rule: SubcommandRule, args: readonly string[]): boolean {
  return (rule.readForms ?? []).some(
    (form) =>
      args.length >= form.args.length &&
      form.args.every((arg, index) => args[index] === arg) &&
      (form.rest === true || args.length === form.args.length),
  );
}

/**
 * Loại thao tác hiệu lực của một lệnh (nguồn sự thật cho khoá theo repo và quyền huỷ): loại của subcommand, nhưng subcommand
 * `write` mà args khớp một dạng chỉ-đọc (`stash list`, `remote -v`…) thì là `read`. `undefined` = subcommand không có trong chính
 * sách. Rust (`derived_kind`) phải cho kết quả giống hệt trên mọi ca `kinds` của `git-policy.vectors.json`.
 */
export function effectiveKind(
  sub: string,
  args: readonly string[] = [],
  policy: GitPolicy = gitPolicy,
): ExecKind | undefined {
  const rule = Object.hasOwn(policy.subcommands, sub) ? policy.subcommands[sub] : undefined;
  if (!rule) return undefined;
  return rule.kind === 'write' && matchesReadForm(rule, args) ? 'read' : rule.kind;
}

export type PolicyViolation =
  | { code: 'sub-not-allowed'; sub: string }
  | { code: 'typed-only'; sub: string; detail: string }
  | { code: 'second-not-allowed'; sub: string; detail: string }
  | { code: 'config-write'; sub: string }
  | { code: 'flag-rejected'; sub: string; detail: string }
  | { code: 'attached-short'; sub: string; detail: string }
  | { code: 'url-rejected'; sub: string; detail: string }
  | { code: 'env-rejected'; sub: string; detail: string };

/**
 * Kiểm tra một lệnh git trước khi chạy. Bản tham chiếu (TS) — Rust (`policy.rs`) phải cho kết quả giống hệt
 * trên mọi ca trong `git-policy.vectors.json`. Quy tắc:
 *  1. `sub` phải có trong `subcommands` (không alias, không đường dẫn).
 *  2. `rejectSecond` / `allowSecond` / `typedSecond` xét đối số đầu tiên sau subcommand (rỗng nếu không có); `aloneSecond`
 *     bắt đối số đầu đó là đối số duy nhất.
 *  3. `config` chỉ được đọc: phải có một cờ trong `requireAny`, không có cờ ghi.
 *  4. Duyệt đối số tới `--` đầu tiên:
 *     - `--ten[=giá trị]`: bị chặn nếu `ten` (hoặc là tiền tố viết tắt ≥ 3 ký tự của) một mục `rejectLong` /
 *       `rejectExtraLong` — git chấp nhận tên dài viết tắt, `--upl=…` chính là `--upload-pack` — trừ khi nằm trong `allowLong`.
 *     - `-X` (đúng 2 ký tự): bị chặn nếu thuộc `rejectShort` ∪ `rejectExtraShort` mà không thuộc `allowShort`.
 *     - `-Xgiá-trị` / `-abc` (gắn liền / gộp): chỉ được khi khớp một mẫu `shortAttached` và chữ đầu không bị chặn.
 *  5. Lệnh có `urls`: mọi đối số không phải tuỳ chọn (kể cả sau `--`) không được mở đầu bằng `ext::`, `fd::`
 *     (không phân biệt hoa thường) hay dùng scheme `ext`/`fd`.
 *  6. `env` từ phía gọi chỉ gồm khoá trong `env.fromCaller` với giá trị cho phép (đường dẫn kiểm ở adapter).
 */
export function validateGitCommand(
  sub: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  policy: GitPolicy = gitPolicy,
): PolicyViolation | null {
  const rule = Object.hasOwn(policy.subcommands, sub) ? policy.subcommands[sub] : undefined;
  if (!rule) return { code: 'sub-not-allowed', sub };

  const second = args[0] ?? '';
  if (rule.rejectSecond?.includes(second)) return { code: 'second-not-allowed', sub, detail: second };
  if (rule.allowSecond && !rule.allowSecond.includes(second)) {
    if (rule.typedSecond?.includes(second)) return { code: 'typed-only', sub, detail: `${sub} ${second}` };
    return { code: 'second-not-allowed', sub, detail: second };
  }
  // `remote -v add …` / `remote -v update`: git nhận `-v` đứng trước subcommand nên chỉ xét đối số đầu là chưa đủ.
  if (rule.aloneSecond?.includes(second) && args.length > 1) {
    return { code: 'second-not-allowed', sub, detail: args.slice(0, 2).join(' ') };
  }
  if (rule.requireAny && !args.some((arg) => rule.requireAny?.includes(arg)))
    return { code: 'config-write', sub };

  const rejectedLong = [...policy.rejectLong, ...(rule.rejectExtraLong ?? [])];
  const rejectedShort = new Set([...policy.rejectShort, ...(rule.rejectExtraShort ?? [])]);
  const allowedShort = new Set(rule.allowShort ?? []);
  const attachedPatterns = policy.shortAttached.map((pattern) => new RegExp(pattern));

  let endOfOptions = false;
  for (const arg of args) {
    if (!endOfOptions && arg === '--') {
      endOfOptions = true;
      continue;
    }
    const isOption = !endOfOptions && arg.length > 1 && arg.startsWith('-');
    if (isOption && arg.startsWith('--')) {
      const name = arg.split('=', 1)[0] ?? arg;
      if (rule.allowLong?.includes(name)) continue;
      if (
        name.length >= 3 &&
        rejectedLong.some((rejected) => rejected === name || rejected.startsWith(name))
      ) {
        return { code: 'flag-rejected', sub, detail: name };
      }
      continue;
    }
    if (isOption) {
      const flag = arg.slice(0, 2);
      if (rejectedShort.has(flag) && !allowedShort.has(flag))
        return { code: 'flag-rejected', sub, detail: flag };
      if (arg.length > 2 && !attachedPatterns.some((pattern) => pattern.test(arg))) {
        return { code: 'attached-short', sub, detail: arg };
      }
      continue;
    }
    if (rule.urls && isRejectedUrl(arg, policy)) return { code: 'url-rejected', sub, detail: arg };
  }

  for (const [key, value] of Object.entries(env)) {
    const allowed = Object.hasOwn(policy.env.fromCaller, key) ? policy.env.fromCaller[key] : undefined;
    if (!allowed) return { code: 'env-rejected', sub, detail: key };
    if (allowed.values && !allowed.values.includes(value))
      return { code: 'env-rejected', sub, detail: `${key}=${value}` };
  }
  return null;
}

function isRejectedUrl(arg: string, policy: GitPolicy): boolean {
  const lower = arg.toLowerCase();
  if (policy.url.rejectPrefixes.some((prefix) => lower.startsWith(prefix))) return true;
  const scheme = /^([a-z][a-z0-9+.-]*)::/.exec(lower)?.[1];
  return scheme !== undefined && policy.url.rejectSchemes.includes(scheme);
}

/** Đối số chèn trước subcommand (`-c k=v` …) và sau subcommand (`--no-ext-diff --no-textconv` cho lệnh sinh diff). */
export function buildGitArgv(sub: string, args: readonly string[], policy: GitPolicy = gitPolicy): string[] {
  const head = policy.globalConfig.flatMap((entry) => ['-c', entry]);
  const safety = policy.diffSafety.after.find(
    (path) => path[0] === sub && (path.length === 1 || path[1] === args[0]),
  );
  if (!safety) return [...head, sub, ...args];
  // `stash show`: chèn sau "show"; các lệnh khác: ngay sau subcommand.
  const consumed = safety.length - 1;
  return [...head, sub, ...args.slice(0, consumed), ...policy.diffSafety.args, ...args.slice(consumed)];
}

/** Môi trường chạy git từ môi trường gốc của tiến trình (port y nguyên GitEnvironment.swift + các biến bị bỏ). */
export function buildGitEnv(
  base: Readonly<Record<string, string | undefined>>,
  options: {
    profile: EnvProfile;
    callerEnv?: Readonly<Record<string, string>>;
    askpass?: string;
    askpassDeny?: string;
  },
  policy: GitPolicy = gitPolicy,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (policy.env.remove.includes(key)) continue;
    if (policy.env.removePrefixes.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  Object.assign(env, policy.env.set);
  for (const [key, value] of Object.entries(policy.env.setIfMissing)) {
    if (!env[key]) env[key] = value;
  }
  for (const [key, value] of Object.entries(policy.env.profiles[options.profile])) {
    if (value === '<askpass>') {
      if (options.askpass) env[key] = options.askpass;
    } else if (value === '<askpass-deny>') {
      if (options.askpassDeny) env[key] = options.askpassDeny;
    } else {
      env[key] = value;
    }
  }
  Object.assign(env, options.callerEnv ?? {});
  return env;
}
