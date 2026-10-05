// Progress label of an in-flight operation (merge / rebase / cherry-pick / revert / git am / bisect) in the
// active language. The `@thaigit/core` kernel only returns the operation kind plus a git-style short name
// (`operationShortName`); wording like "Đang merge" / "Merging" is translated by the app, exactly like
// the Swift build's `String(localized:)`.

import type { RepoOperation } from '@thaigit/core';

import { vi } from './strings.vi.ts';

/** In-flight operation banner + the sub-line under the repo name + that operation's error message. */
export function operationTitle(operation: RepoOperation): string {
  if (operation.kind === 'rebasing' && operation.step !== null && operation.total !== null) {
    return vi.branches.runningRebaseStep(operation.step, operation.total);
  }
  return vi.branches.running[operation.kind];
}
