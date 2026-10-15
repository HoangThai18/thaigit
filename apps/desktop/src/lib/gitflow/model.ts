// Git-flow without the git-flow extension: the same config keys (`gitflow.branch.*`, `gitflow.prefix.*`) so a
// repo set up by git-flow / git-flow AVH / SourceTree is recognised, and finishing a branch is a plain
// sequence of switch / merge --no-ff / tag / delete run by the app.

import { isValidRefName } from '@thaigit/core';

export type FlowKind = 'feature' | 'release' | 'hotfix';

export const FLOW_KINDS: readonly FlowKind[] = ['feature', 'release', 'hotfix'];

export interface GitFlowConfig {
  master: string;
  develop: string;
  prefixes: Record<FlowKind, string>;
  versionTag: string;
}

export const GITFLOW_KEYS = {
  master: 'gitflow.branch.master',
  develop: 'gitflow.branch.develop',
  feature: 'gitflow.prefix.feature',
  release: 'gitflow.prefix.release',
  hotfix: 'gitflow.prefix.hotfix',
  versionTag: 'gitflow.prefix.versiontag',
} as const;

/** The repo's git-flow setup, or `null` when it has not been initialised (no main / develop branch configured). */
export function readGitFlow(entries: ReadonlyMap<string, string>): GitFlowConfig | null {
  const master = entries.get(GITFLOW_KEYS.master)?.trim() ?? '';
  const develop = entries.get(GITFLOW_KEYS.develop)?.trim() ?? '';
  if (master === '' || develop === '') return null;
  const prefix = (kind: FlowKind) => entries.get(GITFLOW_KEYS[kind])?.trim() || `${kind}/`;
  return {
    master,
    develop,
    prefixes: { feature: prefix('feature'), release: prefix('release'), hotfix: prefix('hotfix') },
    versionTag: entries.get(GITFLOW_KEYS.versionTag)?.trim() ?? '',
  };
}

/** Suggested setup for a repo that has none yet: `main` (or `master`) as the production branch, `develop`, the usual prefixes. */
export function defaultGitFlow(localBranches: readonly string[]): GitFlowConfig {
  const master = ['main', 'master'].find((name) => localBranches.includes(name)) ?? 'main';
  return {
    master,
    develop: 'develop',
    prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' },
    versionTag: '',
  };
}

export interface FlowBranch {
  kind: FlowKind;
  /** The part after the prefix (`login` in `feature/login`, `1.2.0` in `release/1.2.0`). */
  name: string;
  branch: string;
}

export function flowBranchOf(config: GitFlowConfig, branch: string): FlowBranch | null {
  for (const kind of FLOW_KINDS) {
    const prefix = config.prefixes[kind];
    if (branch.startsWith(prefix) && branch.length > prefix.length) {
      return { kind, name: branch.slice(prefix.length), branch };
    }
  }
  return null;
}

export function flowBranches(config: GitFlowConfig, localBranches: readonly string[]): FlowBranch[] {
  return localBranches
    .map((branch) => flowBranchOf(config, branch))
    .filter((item): item is FlowBranch => item !== null);
}

/** Where a new branch of `kind` starts: hotfixes from the production branch, everything else from develop. */
export function flowBase(config: GitFlowConfig, kind: FlowKind): string {
  return kind === 'hotfix' ? config.master : config.develop;
}

/** The branches a finished branch is merged into, in order: a feature into develop; a release / hotfix into main, then develop. */
export function finishTargets(config: GitFlowConfig, kind: FlowKind): string[] {
  return kind === 'feature' ? [config.develop] : [config.master, config.develop];
}

/** The version tag a finished release / hotfix gets (`null` for a feature). */
export function finishTag(config: GitFlowConfig, item: FlowBranch): string | null {
  return item.kind === 'feature' ? null : `${config.versionTag}${item.name}`;
}

/** Why a setup cannot be saved (`null` = fine): names must be valid, main ≠ develop, prefixes non-empty and distinct. */
export function setupProblem(config: GitFlowConfig): 'branch' | 'same' | 'prefix' | null {
  if (!isValidRefName(config.master) || !isValidRefName(config.develop)) return 'branch';
  if (config.master === config.develop) return 'same';
  const prefixes = FLOW_KINDS.map((kind) => config.prefixes[kind]);
  if (prefixes.some((prefix) => prefix === '' || !isValidRefName(`${prefix}x`))) return 'prefix';
  if (new Set(prefixes).size !== prefixes.length) return 'prefix';
  if (config.versionTag !== '' && !isValidRefName(`${config.versionTag}1`, false)) return 'prefix';
  return null;
}
