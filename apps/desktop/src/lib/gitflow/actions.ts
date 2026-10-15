// Git-flow actions: set up (config keys + develop branch), start a feature / release / hotfix, finish one
// (merge --no-ff into its targets, tag a release / hotfix, delete the branch). Finishing re-runs safely after
// a conflict: merges already done are no-ops and an existing tag is not recreated.

import { isStatusClean, isValidRefName, refName } from '@thaigit/core';
import { createBranch } from '../actions/branches.ts';
import { onConflict } from '../actions/history.ts';
import {
  dialogs as globalDialogs,
  flagValue,
  textValue,
  type DialogStore,
  type FormValues,
} from '../stores/dialogs.svelte.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import {
  defaultGitFlow,
  finishTag,
  finishTargets,
  flowBase,
  flowBranchOf,
  readGitFlow,
  setupProblem,
  GITFLOW_KEYS,
  type FlowBranch,
  type FlowKind,
  type GitFlowConfig,
} from './model.ts';

const cache = new WeakMap<RepoStore, GitFlowConfig | null>();

/** The last setup read for this repo (`undefined` = not read yet). Menus built synchronously use it. */
export function cachedGitFlow(store: RepoStore): GitFlowConfig | null | undefined {
  return cache.get(store);
}

export async function loadGitFlow(store: RepoStore): Promise<GitFlowConfig | null> {
  try {
    const config = readGitFlow(await store.git.configEntries('^gitflow\\.'));
    cache.set(store, config);
    return config;
  } catch {
    return cache.get(store) ?? null;
  }
}

function localNames(store: RepoStore): string[] {
  return store.localBranches.map((ref) => refName(ref));
}

function configFrom(values: FormValues): GitFlowConfig {
  return {
    master: textValue(values, 'master'),
    develop: textValue(values, 'develop'),
    prefixes: {
      feature: textValue(values, 'feature'),
      release: textValue(values, 'release'),
      hotfix: textValue(values, 'hotfix'),
    },
    versionTag: textValue(values, 'versionTag'),
  };
}

export async function setupGitFlow(store: RepoStore, dialogs?: DialogStore): Promise<void> {
  const text = vi.gitflow;
  const names = localNames(store);
  const current = (await loadGitFlow(store)) ?? defaultGitFlow(names);
  const field = (id: string, label: string, value: string) =>
    ({ kind: 'text', id, label, value, monospace: true }) as const;
  const values = await (dialogs ?? globalDialogs).form({
    title: text.setupTitle,
    message: text.setupMessage,
    confirmTitle: text.setupConfirm,
    fields: [
      field('master', text.masterLabel, current.master),
      field('develop', text.developLabel, current.develop),
      field('feature', text.featureLabel, current.prefixes.feature),
      field('release', text.releaseLabel, current.prefixes.release),
      field('hotfix', text.hotfixLabel, current.prefixes.hotfix),
      field('versionTag', text.versionTagLabel, current.versionTag),
    ],
    validate: (draft) => {
      const config = configFrom(draft);
      const problem = setupProblem(config);
      if (problem === 'branch') return text.problemBranch;
      if (problem === 'same') return text.problemSame;
      if (problem === 'prefix') return text.problemPrefix;
      if (!names.includes(config.master)) return text.masterMissing(config.master);
      return null;
    },
  });
  if (!values) return;
  const config = configFrom(values);
  const createDevelop = !names.includes(config.develop);
  await store.perform(
    text.setupTitleNamed,
    async (git) => {
      await git.setConfig(GITFLOW_KEYS.master, config.master, 'local');
      await git.setConfig(GITFLOW_KEYS.develop, config.develop, 'local');
      for (const kind of ['feature', 'release', 'hotfix'] as const) {
        await git.setConfig(GITFLOW_KEYS[kind], config.prefixes[kind], 'local');
      }
      await git.setConfig(GITFLOW_KEYS.versionTag, config.versionTag, 'local');
      if (createDevelop) await git.createBranch(config.develop, config.master, false);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        cache.set(store, config);
        store.notify('success', text.setupDone(config.develop));
      },
    },
  );
}

export async function startFlow(
  store: RepoStore,
  config: GitFlowConfig,
  kind: FlowKind,
  dialogs?: DialogStore,
): Promise<void> {
  const text = vi.gitflow;
  const kindName = text.kindName[kind];
  const base = flowBase(config, kind);
  const names = localNames(store);
  if (!names.includes(base)) {
    store.notify('warning', text.baseMissing(base));
    return;
  }
  const prefix = config.prefixes[kind];
  const values = await (dialogs ?? globalDialogs).form({
    title: text.startTitle(kindName),
    message: text.startMessage(kindName, base),
    confirmTitle: vi.branches.create,
    fields: [
      {
        kind: 'text',
        id: 'name',
        label: text.nameLabel(kind),
        value: '',
        placeholder: text.namePlaceholder(kind),
        monospace: true,
      },
    ],
    validate: (draft) => {
      const name = textValue(draft, 'name');
      if (name === '') return vi.branches.nameRequired;
      const branch = `${prefix}${name}`;
      if (!isValidRefName(branch)) return vi.branches.nameInvalid;
      if (names.includes(branch)) return vi.branches.nameExists(branch);
      return null;
    },
  });
  if (!values) return;
  await createBranch(store, `${prefix}${textValue(values, 'name')}`, base, true, dialogs);
}

export async function finishFlow(
  store: RepoStore,
  config: GitFlowConfig,
  branch: string,
  dialogs?: DialogStore,
): Promise<void> {
  const text = vi.gitflow;
  const item = flowBranchOf(config, branch);
  if (item === null) return;
  if (store.operation !== null) {
    store.notify('warning', text.needNoOperation);
    return;
  }
  if (!isStatusClean(store.status)) {
    store.notify('warning', text.needClean);
    return;
  }
  const names = localNames(store);
  const targets = finishTargets(config, item.kind).filter((target) => names.includes(target));
  if (targets.length === 0) {
    store.notify('warning', text.baseMissing(flowBase(config, item.kind)));
    return;
  }
  const tag = finishTag(config, item);
  const targetList = targets.join(text.and);
  const values = await (dialogs ?? globalDialogs).form({
    title: text.finishTitle(branch),
    message: text.finishSteps(branch, targetList, tag),
    confirmTitle: text.finishConfirm,
    fields: [{ kind: 'checkbox', id: 'delete', label: text.deleteAfter, value: true }],
  });
  if (!values) return;
  await runFinish(store, item, targets, tag, flagValue(values, 'delete'));
}

function runFinish(
  store: RepoStore,
  item: FlowBranch,
  targets: readonly string[],
  tag: string | null,
  deleteAfter: boolean,
): Promise<void> {
  const text = vi.gitflow;
  const tagExists = tag !== null && store.tags.some((ref) => refName(ref) === tag);
  return store.perform(
    text.finishTitle(item.branch),
    async (git) => {
      for (const [index, target] of targets.entries()) {
        await git.switchTo(target);
        await git.merge(item.branch, 'noFastForward');
        if (index === 0 && tag !== null && !tagExists) await git.createTag(tag, 'HEAD', text.tagMessage(tag));
      }
      if (deleteAfter) await git.deleteBranch(item.branch, false);
    },
    {
      refresh: Scope.all,
      onSuccess: () => store.notify('success', text.finished(item.branch, targets.join(text.and))),
      onError: onConflict(store, 'Merge'),
    },
  );
}
