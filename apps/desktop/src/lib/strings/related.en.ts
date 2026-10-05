/** Bản tiếng Anh của `related.vi.ts` (cùng khoá, cùng tham số). */
import type { related as source } from './related.vi.ts';
import type { Translation } from './types.ts';

export const related: Translation<typeof source> = {
  worktrees: 'WORKTREES',
  submodules: 'SUBMODULES',
  worktreeCurrent: 'Open worktree',
  worktreeMain: 'Main worktree',
  worktreeDetached: (sha: string) => `detached HEAD @ ${sha}`,
  worktreeMissing: 'The folder is gone — use “Prune missing worktrees”',
  worktreeLocked: 'Locked (git worktree lock)',
  noWorktrees: 'Only the main worktree',
  submoduleUninitialized: 'Not initialized — right-click → Update',
  submoduleModified: 'At a different commit than the parent repository records',
  submoduleConflict: 'Conflicted',

  openInNewWindow: 'Open in New Window',
  copyPath: 'Copy Path',
  pathLabel: 'path',
  addWorktree: 'Add Worktree…',
  removeWorktree: 'Remove Worktree…',
  pruneWorktrees: 'Prune Missing Worktrees',
  updateSubmodule: 'Update This Submodule',
  updateAllSubmodules: 'Update All Submodules',
  syncSubmodules: 'Sync Submodule URLs',
  openFailed: 'Couldn’t open a new window',

  addTitle: 'Add worktree',
  addMessage: (folder: string) =>
    `A worktree is a second working folder of the same repository with another branch checked out — work in parallel without stashing or switching branches. The new folder goes in ${folder}.`,
  branchLabel: 'Branch',
  createBranch: 'Create a new branch from the current commit',
  folderLabel: 'Folder name',
  branchRequired: 'Enter a branch name',
  branchInvalid: 'Invalid branch name (no spaces, none of ~ ^ : ? * [ \\, no “..”)',
  branchExists: (name: string) => `Branch ${name} already exists — untick “Create a new branch” to use it`,
  branchMissing: (name: string) => `There’s no branch ${name} — tick “Create a new branch”`,
  branchCheckedOut: (name: string) => `Branch ${name} is already checked out in another worktree`,
  folderRequired: 'Enter a folder name',
  folderInvalid: 'The folder name can’t contain / \\ : * ? " < > | and can’t be . or ..',
  addConfirm: 'Add worktree',
  addRunning: (branch: string) => `Add worktree for ${branch}`,
  added: (branch: string) => `Added a worktree for ${branch}`,

  removeConfirmTitle: (name: string) => `Remove worktree ${name}?`,
  removeConfirmMessage:
    'The worktree folder will be deleted; the branch and its commits stay in the repository. Git refuses if the worktree has uncommitted changes.',
  removeConfirm: 'Remove worktree',
  removeRunning: (name: string) => `Remove worktree ${name}`,
  removed: (name: string) => `Removed worktree ${name}`,
  removeDirty: (name: string) => `Worktree ${name} has uncommitted changes`,
  forceRemoveTitle: (name: string) => `Remove worktree ${name} anyway?`,
  forceRemoveMessage: 'All uncommitted changes in this worktree will be LOST PERMANENTLY.',
  forceRemove: 'Remove anyway',
  pruneRunning: 'Prune missing worktrees',
  pruned: 'Pruned worktrees whose folders are gone',

  updateRunning: (count: number | null) =>
    count === null ? 'Update submodules' : `Update ${count} ${count === 1 ? 'submodule' : 'submodules'}`,
  updated: 'Submodules updated',
  syncRunning: 'Sync submodule URLs',
  synced: 'Submodule URLs synced',
};
