/** Bản tiếng Anh của `remote.vi.ts` (cùng khoá, cùng tham số). */
import type { remote as source } from './remote.vi.ts';
import type { Translation } from './types.ts';

export const remote: Translation<typeof source> = {
  fetch: 'Fetch',
  fetchTip: 'Get the latest information from all remotes (Ctrl+Alt+F)',
  pull: 'Pull',
  pullBehind: (count: number) => `Pull ↓${count}`,
  pullTip: 'Bring new commits from the remote into the current branch (Ctrl+Shift+L)',
  pullOptions: 'Other pull modes',
  pullMerge: 'Pull (merge if needed)',
  pullRebase: 'Pull (rebase)',
  pullFastForward: 'Pull (fast-forward only)',
  fetchOnly: 'Fetch only',
  push: 'Push',
  pushAhead: (count: number) => `Push ↑${count}`,
  pushTip: "Send the current branch's commits to the remote (Ctrl+Shift+P)",
  branch: 'Branch',
  branchTip: 'Create a new branch from the current commit (Ctrl+Shift+B)',
  stash: 'Stash',
  stashTip: 'Put all uncommitted changes aside',
  pop: 'Pop',
  popTip: 'Bring back the latest stash',
  more: 'More',
  refresh: 'Refresh',
  commandLog: 'Git command log…',
  switchBranchTip: 'Switch branch',
  recentBranches: 'Recent branches',
  localBranches: 'Local branches',
  noBranches: 'No branches yet',
  newBranchHere: 'New branch…',

  cancel: 'Cancel',
  cancelTip: 'Stop the running network operation',

  noRemote: 'This repository has no remotes yet',
  fetched: 'Fetch complete',
  autoFetchFailed: 'Automatic fetch failed',

  historyGapsTitle: (missingBranches: boolean) =>
    missingBranches
      ? "The repository doesn't have all branches from the remote"
      : "The repository doesn't have the full history from the remote",
  historyGapsNarrow: (remotes: readonly string[]) =>
    `The repository only tracks a few branches of ${remotes.join(', ')}, so other branches on the remote don't show up, even after Fetch.`,
  historyGapsShallow: 'This is a shallow clone, so older commits are missing.',
  completeHistory: 'Get everything from the remote',
  completeHistoryTip: 'Track every branch of the remote, download the missing commits, then fetch',
  historyCompleted: 'All branches and history fetched from the remote',
  later: 'Later',

  needBranchToPull: 'You need to be on a branch to pull',
  noUpstream: (branch: string) => `Branch ${branch} has no matching branch on the remote yet`,
  pushToRemote: 'Push to remote',
  pulled: (branch: string) => `Pulled into ${branch}`,
  upToDate: (branch: string) => `${branch} is up to date`,
  undoPull: 'Undo pull',
  diverged: 'The local and remote branches have diverged',
  pullWithMerge: 'Pull (merge)',
  pullWithRebase: 'Pull (rebase)',

  needBranchToPush: 'You need to be on a branch to push',
  pushTitle: (branch: string) => `Push ${branch}`,
  forcePushTitle: (branch: string) => `Force push ${branch}`,
  pushed: (branch: string, target: string) => `Pushed ${branch} → ${target}`,
  rejected: "Push rejected — the remote has commits you don't have yet",
  pullFirst: 'Pull first',
  pullThenPush: 'Pull, then push',
  syncBranch: 'Sync (pull, then push)',
  forcePush: 'Force push…',
  forcePushConfirmTitle: (branch: string) => `Force push ${branch}?`,
  forcePushConfirmMessage: (target: string) =>
    `Overwrite ${target} with your local version (--force-with-lease: stops if the remote has new commits you haven't fetched).`,
  forcePushConfirm: 'Force push',
  publishTitle: (branch: string) => `Push branch ${branch} to the remote`,
  publishMessage:
    'This branch has no matching branch on the remote yet. Thaigit will create it on the remote and set it as the upstream.',
  publishRemote: 'Remote',
  publishBranch: 'Branch name on the remote',
  publishConfirm: 'Push',
  invalidRemoteBranch: 'Invalid branch name',

  conflict: (operation: string) => `${operation} ran into conflicts`,
  conflictMessage:
    'Open the conflicted files in the right panel to choose what to keep, then click “Continue”.',
  blockedByChanges: (operation: string) => `${operation} is blocked by uncommitted changes`,
  stashChanges: 'Stash changes',
  authFailed: (operation: string) => `${operation}: the remote rejected the sign-in`,
  authFailedMessage:
    'Check the account / token for the remote (Settings → Accounts, or Git Credential Manager / Keychain) and try again.',
  hostUnreachable: (operation: string) => `${operation}: couldn't connect to the remote`,

  askpassUsernameTitle: (host: string | null) => (host ? `Sign in to ${host}` : 'Sign in'),
  askpassUsernameLabel: 'Username',
  askpassPasswordTitle: (host: string | null) => (host ? `Password for ${host}` : 'Password'),
  askpassPasswordLabel: 'Password or token',
  askpassPassphraseTitle: 'SSH key passphrase',
  askpassPassphraseLabel: 'Passphrase',
  askpassOtherTitle: 'Git needs your confirmation',
  askpassOtherLabel: 'Answer',
  askpassWaiting: (operation: string) => `${operation} is waiting for sign-in details.`,
  askpassGithubToken: "GitHub doesn't accept account passwords — use a Personal access token.",
  askpassPrivacy: 'Thaigit only passes your answer to git and does not store it.',
  askpassContinue: 'Continue',

  commandLogTitle: 'Git command log',
  commandLogEmpty: 'No commands run yet.',
  commandLogClose: 'Close',
  commandLogCopy: 'Copy',
  commandLogCancelled: 'cancelled',
};
