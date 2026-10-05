import policyJson from '../git-policy.json' with { type: 'json' };

/** Operation kind: decides per-repo locking (`write`/`network` are exclusive) and how it can be cancelled (only `network`). */
export type ExecKind = 'read' | 'write' | 'network';

/** Environment profile: `background` (autofetch) never raises the sign-in dialog. */
export type EnvProfile = 'interactive' | 'background';

/**
 * Read-only shape of a `write` subcommand: matches when args START with exactly `args` and, unless `rest`, have nothing
 * after it (`remote -v` is read-only, `remote -v update` is not).
 */
export interface ReadForm {
  args: string[];
  /** Allow arbitrary trailing args after `args` (e.g. `stash list --format=…`, `remote get-url origin`). */
  rest?: boolean;
}

export interface SubcommandRule {
  kind: ExecKind;
  allowShort?: string[];
  allowLong?: string[];
  allowSecond?: string[];
  typedSecond?: string[];
  /** Kind overridden by the first arg (`lfs fetch` → `network`); falls back to `kind`. */
  secondKinds?: Record<string, ExecKind>;
  rejectSecond?: string[];
  /** First args in this list must be the ONLY arg (`remote -v` ok, `remote -v add …` blocked). */
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

/** Do `args` match any read-only shape (`readForms`) of `rule` in full? */
export function matchesReadForm(rule: SubcommandRule, args: readonly string[]): boolean {
  return (rule.readForms ?? []).some(
    (form) =>
      args.length >= form.args.length &&
      form.args.every((arg, index) => args[index] === arg) &&
      (form.rest === true || args.length === form.args.length),
  );
}

/**
 * Effective kind of a command (the source of truth for per-repo locking and cancellation): the subcommand's kind, or the
 * first arg's kind (`secondKinds`) — except a `write` command whose args match a read-only shape (`stash list`,
 * `remote -v`…) is `read`. `undefined` means the subcommand is absent from the policy.
 *
 * Rust (`derived_kind`) must agree with this on every case of the `kinds` array in `git-policy.vectors.json`.
 */
export function effectiveKind(
  sub: string,
  args: readonly string[] = [],
  policy: GitPolicy = gitPolicy,
): ExecKind | undefined {
  const rule = Object.hasOwn(policy.subcommands, sub) ? policy.subcommands[sub] : undefined;
  if (!rule) return undefined;
  const second = args[0];
  const kind =
    second !== undefined && rule.secondKinds && Object.hasOwn(rule.secondKinds, second)
      ? rule.secondKinds[second]!
      : rule.kind;
  return kind === 'write' && matchesReadForm(rule, args) ? 'read' : kind;
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
 * Validate a git command before running it. The TS side is the reference — Rust (`policy.rs`) must agree on every case
 * in `git-policy.vectors.json`. Rules:
 *  1. `sub` must exist in `subcommands` (no aliases, no paths).
 *  2. `rejectSecond` / `allowSecond` / `typedSecond` inspect the first arg after the subcommand (empty when there is
 *     none); `aloneSecond` additionally requires that arg to be the only one.
 *  3. `config` is read-only: one of the flags in `requireAny` must be present and no write flag may be.
 *  4. Walk args up to the first `--`:
 *     - `--name[=value]`: rejected if `name` — or any abbreviation of it ≥ 3 chars — appears in `rejectLong` /
 *       `rejectExtraLong` (git accepts long-name abbreviations, so `--upl=…` is `--upload-pack`), unless in `allowLong`.
 *     - `-X` (exactly 2 chars): rejected if in `rejectShort` ∪ `rejectExtraShort` and not in `allowShort`.
 *     - `-Xvalue` / `-abc` (attached / bundled): allowed only when matching a `shortAttached` pattern and the leading
 *       char is not rejected.
 *  5. Commands with `urls`: no non-option arg (including after `--`) may start with `ext::`, `fd::` (any case) or use
 *     the `ext`/`fd` scheme.
 *  6. Caller-supplied `env` may only carry keys listed in `env.fromCaller` with allowed values (path checks happen in
 *     the adapter).
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
  // `remote -v add …` / `remote -v update`: git accepts `-v` before the subcommand, so checking the first arg alone is not enough.
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

/** Args inserted before the subcommand (`-c k=v` …) and after it (`--no-ext-diff --no-textconv` for diff-producing commands). */
export function buildGitArgv(sub: string, args: readonly string[], policy: GitPolicy = gitPolicy): string[] {
  const head = policy.globalConfig.flatMap((entry) => ['-c', entry]);
  const safety = policy.diffSafety.after.find(
    (path) => path[0] === sub && (path.length === 1 || path[1] === args[0]),
  );
  if (!safety) return [...head, sub, ...args];
  // `stash show`: insert after "show"; every other command: right after the subcommand.
  const consumed = safety.length - 1;
  return [...head, sub, ...args.slice(0, consumed), ...policy.diffSafety.args, ...args.slice(consumed)];
}

/** Git environment derived from the process environment (a direct port of GitEnvironment.swift minus dropped vars). */
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
