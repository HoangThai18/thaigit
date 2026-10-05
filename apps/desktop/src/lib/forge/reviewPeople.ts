// Assign reviewers / assignees for the PR / MR on screen: load the list of assignable people and send the
// new list to the host (Rust picks the account by owner; the result is the PR / MR re-read from the host).

import type { ForgePerson } from '@thaigit/contracts';
import { forgeListAssignable, forgeSetPeople, type PeopleRole } from '../ipc/accounts.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import { targetOf } from './pullRequests.ts';

/** Load the assignable-people list (once per PR on screen; on failure the next time the picker opens retries). */
export async function loadReviewPeople(store: RepoStore): Promise<void> {
  const target = targetOf(store);
  const review = store.review;
  if (target === null) return;
  const token = review.beginPeople();
  if (token === null) return;
  try {
    const people = await forgeListAssignable({
      host: target.host,
      provider: target.provider ?? undefined,
      owner: target.owner,
      repo: target.repo,
    });
    review.finishPeople(token, people);
  } catch (error) {
    review.failPeople(token);
    store.notify('warning', vi.pullRequests.peopleLoadFailed, { message: forgeErrorText(error) });
  }
}

/** Send the NEW reviewer / assignee lists (replacing the old ones); `true` if the host accepted them. */
export async function saveReviewPeople(
  store: RepoStore,
  role: PeopleRole,
  people: readonly ForgePerson[],
): Promise<boolean> {
  const target = targetOf(store);
  const review = store.review;
  const request = review.request;
  if (target === null || request === null || !review.beginSaving()) return false;
  const text = vi.pullRequests;
  try {
    const updated = await forgeSetPeople({
      host: target.host,
      provider: target.provider ?? undefined,
      owner: target.owner,
      repo: target.repo,
      number: request.number,
      role,
      people: [...people],
    });
    review.finishSaving(updated);
    store.notify('success', role === 'reviewers' ? text.reviewersSaved : text.assigneesSaved);
    return true;
  } catch (error) {
    review.failSaving();
    store.notify('warning', text.peopleSaveFailed, { message: forgeErrorText(error) });
    return false;
  }
}
