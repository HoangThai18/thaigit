import type { issues as issuesSource } from './issues.vi.ts';
import type { Translation } from './types.ts';

export const issues: Translation<typeof issuesSource> = {
  section: 'ISSUES',
  empty: 'No open issues.',
  notConnected: 'This repo is not connected to a host the app recognises (GitHub / GitLab / Bitbucket).',
  noAccount: 'Not signed in to this host — add an account in Settings → Accounts.',
  loading: 'Loading…',
  refresh: 'Reload',
  filterPlaceholder: 'Filter issues…',
  noMatch: 'No matching issues.',
  ref: (number: string) => `#${number}`,
  openOnWeb: 'Open on the web',
  copyLink: 'Copy link',
  copyRef: 'Copy issue number',
  linkLabel: 'issue link',
  refLabel: 'issue number',
  createBranch: 'Create a branch for this issue…',
  tooltip: (ref: string, title: string, author: string, comments: number) =>
    `${ref} ${title}\nOpened by ${author}${comments > 0 ? ` · ${comments} ${comments === 1 ? 'comment' : 'comments'}` : ''}`,
  assigned: (names: string) => `Assigned to: ${names}`,
};
