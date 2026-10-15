import type { hooks as hooksSource } from './hooks.vi.ts';
import type { Translation } from './types.ts';

export const hooks: Translation<typeof hooksSource> = {
  section: 'HOOKS',
  running: 'Active',
  blocked: 'Blocked',
  blockedNote: 'This repo is not trusted, so Thaigit does not run these hooks.',
  runningNote: 'Hooks run automatically when you commit, push, check out… inside the app.',
  describe: {
    'pre-commit': 'Runs before a commit — usually lint / tests; it can block the commit.',
    'prepare-commit-msg': 'Prefills the message before you write a commit.',
    'commit-msg': 'Checks the commit message; it can block the commit.',
    'post-commit': 'Runs after a commit is made.',
    'pre-push': 'Runs before a push; it can block the push.',
    'pre-rebase': 'Runs before a rebase; it can block the rebase.',
    'post-checkout': 'Runs after a checkout / branch switch.',
    'post-merge': 'Runs after a merge (pulls too).',
    'pre-merge-commit': 'Runs before a merge commit is made; it can block the merge.',
    'post-rewrite': 'Runs after amend or rebase rewrites commits.',
  },
  custom: 'A custom hook of this repo.',
  skip: 'Skip hooks',
  skipTip: 'Commit with --no-verify: pre-commit and commit-msg do not run this time.',
  commitFailed: 'The commit did not go through — a pre-commit / commit-msg hook may have blocked it',
  commitSkipping: 'Commit without hooks',
  pushFailed: 'The push did not go through — the pre-push hook may have blocked it',
  pushSkipping: 'Push without hooks',
};
