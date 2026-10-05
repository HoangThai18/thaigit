// Node adapters (tests, CLI tools) — `@thaigit/core/node`. The desktop app uses the Tauri adapter instead.

export { NodeExec, describePolicyViolation, type NodeExecOptions } from './exec.ts';
export { NodeGitHost } from './git-host.ts';
export {
  createGitHost,
  locateRepository,
  openRepository,
  type OpenRepositoryOptions,
  type RepositoryLocation,
} from './open.ts';
export type { NodeGitConfig } from './process.ts';
export { DEFAULT_MAX_READ_BYTES, NodeRepoFs, type NodeRepoFsOptions } from './repo-fs.ts';
export {
  NodeTypedGit,
  assertSafeRemoteUrl,
  isAllowedConfigKey,
  type NodeTypedGitOptions,
} from './typed-git.ts';
