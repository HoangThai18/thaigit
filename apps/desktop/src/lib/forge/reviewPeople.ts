// Gán người review / người được gán cho PR / MR đang xem: nạp danh sách người có thể gán và gửi danh sách mới lên máy chủ
// (Rust chọn tài khoản theo owner; kết quả là PR / MR đọc lại từ máy chủ).

import type { ForgePerson } from '@thaigit/contracts';
import { forgeListAssignable, forgeSetPeople, type PeopleRole } from '../ipc/accounts.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { vi } from '../strings.vi.ts';
import { targetOf } from './pullRequests.ts';

/** Nạp danh sách người có thể gán (một lần cho mỗi PR đang xem; lỗi thì lần mở bảng chọn sau thử lại). */
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

/** Gửi danh sách người review / người được gán MỚI (thay hẳn danh sách cũ); `true` nếu máy chủ đã nhận. */
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
