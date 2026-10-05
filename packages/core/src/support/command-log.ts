// The git command log ("Command log" in the app). Credentials are redacted AT WRITE TIME: the in-memory record
// never contains a plaintext password or token, so it cannot leak through the UI, a screenshot or a later error report.

const MASK = '***';

/** `scheme://userinfo@` — userinfo runs to the LAST `@` of the run (a raw password may contain `@`); scheme capped at 32 chars to keep the scan linear. */
const URL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)([^\s/?#]*)@/g;

/** For SSH-like schemes, userinfo without a `:` is just a username (`ssh://git@host`) so it is kept; every other scheme is redacted. */
const USERNAME_ONLY_SCHEMES = new Set(['ssh://', 'git+ssh://', 'ssh+git://', 'git://']);

/** Known token patterns. Each is a fixed prefix plus a character class (no nesting, no ambiguous repetition) so matching cannot backtrack catastrophically. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{8,}/g, // GitHub: ghp_ (PAT), gho_, ghu_, ghs_, ghr_
  /github_pat_[A-Za-z0-9_]{8,}/g, // GitHub fine-grained PAT
  /glpat-[A-Za-z0-9_-]{8,}/g, // GitLab PAT
  /xox[abposr]-[A-Za-z0-9-]{8,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{8,}/g, // AWS access key id
];

/** A leftover `Authorization: Bearer …` header in stderr / args. */
const AUTHORIZATION_HEADER = /(Authorization:[ \t]*)(?:Bearer|Basic|Token)[ \t]+\S+/gi;

/** Redact credentials in one string (command args or stderr). Pure, linear in the string length. */
export function redactSecrets(text: string): string {
  let result = text.replace(URL_USERINFO, (whole, scheme: string, userinfo: string) =>
    !userinfo.includes(':') && USERNAME_ONLY_SCHEMES.has(scheme.toLowerCase()) ? whole : `${scheme}${MASK}@`,
  );
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, MASK);
  return result.replace(AUTHORIZATION_HEADER, `$1${MASK}`);
}

/** One log entry (already redacted). `args` includes the subcommand: `["fetch", "--all"]`. */
export interface GitCommandRecord {
  readonly id: number;
  readonly args: readonly string[];
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly cancelled: boolean;
  /** At most the first `MAX_STDERR_CHARS` characters (truncated AFTER redaction, so a token cannot slip out half-cut). */
  readonly stderr: string;
}

export type RawCommandRecord = Omit<GitCommandRecord, 'id'>;

export const MAX_STDERR_CHARS = 4000;

export function commandLine(record: Pick<GitCommandRecord, 'args'>): string {
  return `git ${record.args.join(' ')}`;
}

/** Ring buffer of executed git commands (keeps the most recent `capacity` entries). */
export class CommandLog {
  private storage: GitCommandRecord[] = [];
  private nextId = 1;
  private readonly listeners = new Set<(record: GitCommandRecord) => void>();

  constructor(private readonly capacity = 400) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity phải là số nguyên ≥ 1');
  }

  /** Redact, then store. Returns the redacted record. */
  record(raw: RawCommandRecord): GitCommandRecord {
    const record: GitCommandRecord = Object.freeze({
      id: this.nextId++,
      args: Object.freeze(raw.args.map(redactSecrets)),
      startedAt: raw.startedAt,
      durationMs: raw.durationMs,
      exitCode: raw.exitCode,
      cancelled: raw.cancelled,
      stderr: redactSecrets(raw.stderr).slice(0, MAX_STDERR_CHARS),
    });
    // Copy on write: arrays already handed to `records` are never mutated later (a stable snapshot for the UI).
    const keep =
      this.storage.length >= this.capacity
        ? this.storage.slice(this.storage.length - this.capacity + 1)
        : this.storage;
    this.storage = [...keep, record];
    for (const listener of this.listeners) listener(record);
    return record;
  }

  /** Immutable snapshot, oldest first. */
  get records(): readonly GitCommandRecord[] {
    return this.storage;
  }

  clear(): void {
    this.storage = [];
  }

  /** Subscribe to new entries (already redacted). Returns an unsubscribe function. */
  subscribe(listener: (record: GitCommandRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
