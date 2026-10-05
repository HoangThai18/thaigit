// Quickly build model data for pure tests (no real git needed).
import type { Commit, GitRef, RefKind } from '@thaigit/core';

const PREFIX: Record<RefKind, string> = {
  localBranch: 'refs/heads/',
  remoteBranch: 'refs/remotes/',
  tag: 'refs/tags/',
};

export function ref(kind: RefKind, name: string, target: string, extra: Partial<GitRef> = {}): GitRef {
  return {
    fullName: PREFIX[kind] + name,
    kind,
    target,
    objectName: target,
    upstream: null,
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    isHead: false,
    date: null,
    ...extra,
  };
}

export const local = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef =>
  ref('localBranch', name, target, extra);
export const remote = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef =>
  ref('remoteBranch', name, target, extra);
export const tag = (name: string, target: string, extra: Partial<GitRef> = {}): GitRef =>
  ref('tag', name, target, extra);

export function commit(id: string, parents: string[] = [], extra: Partial<Commit> = {}): Commit {
  return {
    id,
    parents,
    authorName: 'Phan Thái',
    authorEmail: 'thai@example.com',
    authorDate: 1_700_000_000,
    committerName: 'Phan Thái',
    committerEmail: 'thai@example.com',
    commitDate: 1_700_000_000,
    subject: `commit ${id}`,
    ...extra,
  };
}
