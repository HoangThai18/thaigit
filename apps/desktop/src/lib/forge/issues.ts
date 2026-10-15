// The repo's Issues area: load the open issues (Rust calls the API with the right account's token) and
// suggest a branch name for one. Every string returned by a host is rendered as text.

import type { ForgeIssue } from '@thaigit/contracts';
import { foldText } from '../format/natural.ts';
import { forgeListIssues } from '../ipc/accounts.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { targetOf } from './pullRequests.ts';

export interface IssueState {
  items: ForgeIssue[];
  error: string | null;
  needsAccount: boolean;
}

export async function loadIssues(store: RepoStore): Promise<IssueState> {
  const target = targetOf(store);
  if (target === null) return { items: [], error: null, needsAccount: false };
  try {
    const items = await forgeListIssues({
      host: target.host,
      provider: target.provider ?? undefined,
      owner: target.owner,
      repo: target.repo,
    });
    return { items, error: null, needsAccount: false };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'not-found' || code === 'auth') return { items: [], error: null, needsAccount: true };
    return { items: [], error: forgeErrorText(error), needsAccount: false };
  }
}

const SLUG_LIMIT = 40;

/** `issue/42-loi-dang-nhap`: the number plus an ASCII slug of the title (diacritics folded). */
export function issueBranchName(issue: Pick<ForgeIssue, 'number' | 'title'>): string {
  const number = issue.number.replace(/[^0-9A-Za-z]/g, '');
  const slug = foldText(issue.title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '');
  return slug === '' ? `issue/${number}` : `issue/${number}-${slug}`;
}

/** Issues whose number, title, author or labels contain every typed word (case- and diacritic-insensitive). */
export function filterIssues(items: readonly ForgeIssue[], query: string): ForgeIssue[] {
  const words = foldText(query.trim())
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = foldText([`#${item.number}`, item.title, item.author, ...item.labels].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}
