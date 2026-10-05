// Barrel of `@thaigit/core` for the git part: models, pure parsers, runner, repository, history. (The command log lives
// in `support/command-log.ts` but is re-exported here because the UI wants it. `unquoteGitPath` is deliberately NOT
// re-exported from the barrel.)

export { sha256Hex } from './bytes.ts';
export * from './models.ts';
export {
  FILE_HISTORY_FORMAT,
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  defaultCloneDirectoryName,
  parseBlame,
  parseFileHistory,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatus,
  parseSubmoduleStatus,
  parseTrack,
  parseWorktrees,
  progressFraction,
} from './parsers.ts';
export { parseLfsPatterns, parseLfsPointer, type LfsPattern, type LfsPointer } from './lfs.ts';
export { isValidRefName, isValidRemoteName } from './refname.ts';
export {
  REBASE_ACTIONS,
  rebasePlanProblem,
  rebaseRequest,
  type InteractiveRebaseResult,
  type RebaseAction,
  type RebasePlanProblem,
  type RebaseStep,
} from './rebase.ts';
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
  parseFetchRefspecs,
  tracksAllBranches,
  type ApplyPatchOptions,
  type CommitOptions,
  type FetchOptions,
  type GitRepositoryOptions,
  type HistoryGaps,
  type LogOptions,
  type NetworkOptions,
  type PushOptions,
  type RepositoryErrorKind,
} from './repository.ts';
export {
  SnapshotStore,
  type SnapshotEntry,
  type SnapshotPruneOptions,
  type SnapshotRestoreResult,
  type SnapshotTakeOptions,
} from './snapshot.ts';
export {
  CommandLog,
  MAX_STDERR_CHARS,
  commandLine,
  redactSecrets,
  type GitCommandRecord,
  type RawCommandRecord,
} from '../support/command-log.ts';
