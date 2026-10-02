// Barrel của `@thaigit/core` cho phần git: mô hình, parser thuần, runner, repository, lịch sử. (Nhật ký lệnh nằm ở
// `support/command-log.ts` nhưng tiện cho UI nên xuất lại ở đây. `unquoteGitPath` cố ý KHÔNG xuất lại từ barrel.)

export { sha256Hex } from './bytes.ts';
export * from './models.ts';
export {
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  defaultCloneDirectoryName,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
  parseTrack,
  progressFraction,
} from './parsers.ts';
export { isValidRefName } from './refname.ts';
export { classifyGitPath } from './watch-paths.ts';
export { buildHistory, type BuildHistoryOptions, type History } from './history.ts';
export {
  AdapterError,
  CancelledError,
  GitError,
  GitRunner,
  execKindOf,
  type RunOptions,
  type RunOutput,
} from './runner.ts';
export {
  GitRepository,
  RepositoryError,
  type ApplyPatchOptions,
  type CommitOptions,
  type FetchOptions,
  type GitRepositoryOptions,
  type LogOptions,
  type NetworkOptions,
  type PushOptions,
  type RepositoryErrorKind,
} from './repository.ts';
export {
  CommandLog,
  MAX_STDERR_CHARS,
  commandLine,
  redactSecrets,
  type GitCommandRecord,
  type RawCommandRecord,
} from '../support/command-log.ts';
