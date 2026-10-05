import type { CommandError } from '@thaigit/contracts';

/** Error shape normalised from Rust (`invoke` rejects with `{ code, message }`). */
export class CommandFailure extends Error {
  readonly code: CommandError['code'];

  constructor(code: CommandError['code'], message: string) {
    super(message);
    this.name = 'CommandFailure';
    this.code = code;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<CommandError['code']>([
  'policy',
  'not-found',
  'out-of-scope',
  'conflict',
  'busy',
  'io',
  'git-missing',
  'git-too-old',
  'untrusted',
  'auth',
  'internal',
]);

function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === 'string' &&
    KNOWN_CODES.has(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

/** Anything `invoke` may throw → `CommandFailure` (unrecognised errors become `internal`). */
export function toCommandFailure(error: unknown): CommandFailure {
  if (error instanceof CommandFailure) return error;
  if (isCommandError(error)) return new CommandFailure(error.code, error.message);
  if (typeof error === 'string') return new CommandFailure('internal', error);
  if (error instanceof Error) return new CommandFailure('internal', error.message);
  return new CommandFailure('internal', 'Lỗi không xác định từ lõi Rust');
}

export function isCommandFailure(error: unknown, code?: CommandError['code']): error is CommandFailure {
  return error instanceof CommandFailure && (code === undefined || error.code === code);
}
