// Filters diffs before they are sent to the AI: by file NAME (lockfiles, generated files, sensitive files) and by CONTENT
// (strings that look like keys / tokens / passwords — gitleaks-style, high-signal patterns plus high-entropy strings assigned
// to sensitive-looking names).
// Principle: dropping a harmless hunk is much better than sending a real secret.

export type PathSkipReason = 'lockfile' | 'generated' | 'sensitive';

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'podfile.lock',
  'gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'go.sum',
  'packages.lock.json',
  'package.resolved',
  'mix.lock',
  'pubspec.lock',
  'flake.lock',
  'gradle.lockfile',
  'deno.lock',
]);

/** Directories holding generated files / vendored libraries (matched per path segment). */
const GENERATED_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  'pods',
  'deriveddata',
  '__pycache__',
  'coverage',
]);

const GENERATED_FILES = [
  /\.min\.(?:js|mjs|cjs|css)$/,
  /\.(?:js|css)\.map$/,
  /\.bundle\.js$/,
  /\.pb\.go$/,
  /_pb2(?:_grpc)?\.py$/,
  /\.generated\.[a-z]+$/,
  /\.g\.dart$/,
  /\.designer\.cs$/,
];

const SENSITIVE_FILES = [
  /^\.env(?:\..*)?$/,
  /\.env$/,
  /\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ovpn|ppk|asc|gpg)$/,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/,
  /^\.(?:npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass|dockercfg)$/,
  /^_netrc$/,
  /^credentials.*\.json$/,
  /^service[-_]?account.*\.json$/,
  /^secrets?\..+$/,
  /\.tfvars(?:\.json)?$/,
  /\.tfstate(?:\.backup)?$/,
  /^kubeconfig$/,
  /^appsettings.*\.json$/,
  /^google-services\.json$/,
  /^googleservice-info\.plist$/,
];

/** Why a whole file is dropped by name; `null` = inspect its content. */
export function classifyPath(path: string): PathSkipReason | null {
  const segments = path.toLowerCase().split('/');
  const name = segments[segments.length - 1] ?? '';
  if (SENSITIVE_FILES.some((pattern) => pattern.test(name))) return 'sensitive';
  if (
    segments.slice(0, -1).some((segment) => segment === '.ssh' || segment === '.aws' || segment === '.kube')
  ) {
    return 'sensitive';
  }
  if (LOCKFILES.has(name)) return 'lockfile';
  if (segments.slice(0, -1).some((segment) => GENERATED_DIRS.has(segment))) return 'generated';
  if (GENERATED_FILES.some((pattern) => pattern.test(name))) return 'generated';
  return null;
}

export interface SecretRule {
  id: string;
  pattern: RegExp;
}

/** High-signal patterns (they essentially never match ordinary code by accident). */
export const SECRET_RULES: readonly SecretRule[] = [
  { id: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b/ },
  { id: 'github-pat', pattern: /\bgithub_pat_[0-9A-Za-z_]{22,}\b/ },
  { id: 'gitlab-token', pattern: /\bglpat-[0-9A-Za-z_-]{20,}\b/ },
  { id: 'slack-token', pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'slack-webhook', pattern: /hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]+/ },
  { id: 'ai-api-key', pattern: /\bsk-(?:ant-|proj-|or-)?[0-9A-Za-z_-]{20,}\b/ },
  { id: 'stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{20,}\b/ },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'npm-token', pattern: /\bnpm_[0-9A-Za-z]{36}\b/ },
  { id: 'pypi-token', pattern: /\bpypi-AgEIcHlwaS5vcmc[0-9A-Za-z_-]{40,}/ },
  { id: 'sendgrid-key', pattern: /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b/ },
  { id: 'telegram-bot-token', pattern: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/ },
  { id: 'discord-webhook', pattern: /discord(?:app)?\.com\/api\/webhooks\/\d+\/[0-9A-Za-z_-]{20,}/ },
  { id: 'jwt', pattern: /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
  // URLs with a password: postgres://user:secret@host (needs ":" in the user part, so https://user@host does not match).
  { id: 'url-password', pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/'"]{1,64}:[^\s@/'"]{3,}@[^\s'"]+/i },
];

/** Sensitive-looking variable or key assigned a string: `API_KEY = "…"`, `password: …`, `"client_secret": "…"`. */
const SENSITIVE_ASSIGNMENT =
  /(?:secret|token|passw(?:or)?d|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|credential)[\w.-]*["']?\s*(?::=|=>|[:=])\s*["'`]?([^\s"'`,;)]{8,})/gi;

/** Shannon entropy (bits per character). */
export function shannonEntropy(text: string): number {
  if (text === '') return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  const length = [...text].length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Value that reads like a reference to something else (a variable, function call, environment variable, placeholder) — not a secret. */
function looksLikeReference(value: string): boolean {
  return (
    /^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(value) || // obj.field.sub
    /[()[\]{}<>]/.test(value) || // function call, ${…}, <placeholder>
    /^(?:process\.env|os\.environ|env|getenv|ENV)\b/i.test(value) ||
    /^(?:x{4,}|\*{4,}|changeme|password|secret|example|placeholder|dummy|test|your[_-].*)$/i.test(value) ||
    /^[a-z]+(?:_[a-z]+)*$/.test(value) // ordinary snake_case variable name
  );
}

/** First matching rule code in `text`, or `null`. */
export function findSecret(text: string): string | null {
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(text)) return rule.id;
  }
  for (const match of text.matchAll(SENSITIVE_ASSIGNMENT)) {
    const value = match[1] ?? '';
    if (looksLikeReference(value)) continue;
    if (value.length >= 12 ? shannonEntropy(value) >= 3.2 : shannonEntropy(value) >= 2.8) {
      return 'high-entropy-assignment';
    }
  }
  return null;
}
