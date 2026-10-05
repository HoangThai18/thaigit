import type { WorkingTreeStatus } from '@thaigit/core';
import { vi } from '../strings.vi.ts';

/** Summary of uncommitted changes for the graph's WIP row ("✎ 3 modified   ＋ 2 added   ● 1 staged"). Mirrors Swift's `workingTreeSummary`. */
export function workingTreeSummary(
  status: Pick<WorkingTreeStatus, 'staged' | 'unstaged' | 'conflicts'>,
): string {
  const parts: string[] = [];
  if (status.conflicts.length > 0) parts.push(vi.graph.wipConflicts(status.conflicts.length));
  const modified = new Set<string>();
  for (const change of status.unstaged) if (change.kind !== 'untracked') modified.add(change.path);
  for (const change of status.staged) modified.add(change.path);
  const untracked = status.unstaged.filter((change) => change.kind === 'untracked').length;
  if (modified.size > 0) parts.push(vi.graph.wipModified(modified.size));
  if (untracked > 0) parts.push(vi.graph.wipUntracked(untracked));
  if (status.staged.length > 0) parts.push(vi.graph.wipStaged(status.staged.length));
  return parts.join('   ');
}
