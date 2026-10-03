// Commit / amend từ ô soạn commit (port `commit()` của RepoModel+Actions.swift): ghép tóm tắt + mô tả, commit qua hàng đợi,
// xoá ô soạn khi xong và hiện "Hoàn tác" (soft reset về HEAD cũ — thay đổi trở lại trạng thái đã stage, message trả về ô soạn).

import { vi } from '../strings.vi.ts';
import { Scope, type RepoStore } from '../stores/repo.svelte.ts';

/** Message đầy đủ từ tóm tắt + mô tả (bỏ khoảng trắng thừa hai đầu; mô tả rỗng thì chỉ có tóm tắt). */
export function composeMessage(summary: string, body: string): string {
  const head = summary.trim();
  const rest = body.trim();
  return rest === '' ? head : `${head}\n\n${rest}`;
}

/** Tách message có sẵn (amend, MERGE_MSG) thành tóm tắt + mô tả. */
export function splitMessage(message: string): { summary: string; body: string } {
  const normalized = message.replace(/\r\n/g, '\n').trim();
  const newline = normalized.indexOf('\n');
  if (newline < 0) return { summary: normalized, body: '' };
  return { summary: normalized.slice(0, newline).trim(), body: normalized.slice(newline + 1).trim() };
}

export interface CommitCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

/** Commit được chưa (để bật/tắt nút và giải thích vì sao). */
export function canCommit(store: RepoStore): CommitCheck {
  const draft = store.commitDraft;
  if (draft.summary.trim() === '') return { ok: false, reason: vi.staging.needSummary };
  if (store.status.conflicts.length > 0)
    return { ok: false, reason: vi.staging.conflictsFirst(store.status.conflicts.length) };
  // Amend chỉ sửa message thì không cần gì đã stage; đang merge / revert thì commit hoàn tất thao tác.
  if (store.status.staged.length === 0 && !draft.amend && store.operation === null) {
    return { ok: false, reason: vi.staging.needStaged };
  }
  return { ok: true, reason: null };
}

/**
 * Bật / tắt amend. Bật khi ô soạn trống thì điền sẵn message của commit gần nhất (như Swift), tắt thì trả lại những gì đã
 * gõ trước khi bật.
 */
export async function setAmend(
  store: RepoStore,
  amend: boolean,
  saved: { summary: string; body: string } | null,
): Promise<{ summary: string; body: string } | null> {
  const draft = store.commitDraft;
  draft.amend = amend;
  if (amend) {
    const before = { summary: draft.summary, body: draft.body };
    const head = store.headOid;
    if (head !== null && draft.summary.trim() === '' && draft.body.trim() === '') {
      try {
        const message = splitMessage(await store.git.commitMessage(head));
        draft.summary = message.summary;
        draft.body = message.body;
      } catch {
        // Không đọc được message cũ: để trống cho người dùng tự gõ.
      }
    }
    return before;
  }
  if (saved) {
    draft.summary = saved.summary;
    draft.body = saved.body;
  }
  return null;
}

/** Commit với nội dung ô soạn. `stageAllFirst`: "Stage tất cả & commit". */
export async function commit(store: RepoStore, options: { stageAllFirst?: boolean } = {}): Promise<void> {
  const draft = store.commitDraft;
  const summary = draft.summary;
  const body = draft.body;
  const amend = draft.amend;
  const message = composeMessage(summary, body);
  if (summary.trim() === '') return;
  const previousHead = store.headOid;
  const branch = store.currentBranch ?? 'HEAD';
  let committed = false;
  await store.perform(
    vi.staging.committing,
    async (git) => {
      if (options.stageAllFirst) await git.stageAll();
      await git.commit(message, { amend });
      committed = true;
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        draft.summary = '';
        draft.body = '';
        draft.amend = false;
        store.select({ kind: 'workingTree' });
        store.notify('success', amend ? vi.staging.amended : vi.staging.committed(branch), {
          actions: committed
            ? [
                {
                  title: vi.staging.undo,
                  run: () => void undoCommit(store, previousHead, { summary, body, amend }),
                },
              ]
            : [],
        });
      },
    },
  );
}

/**
 * Hoàn tác commit vừa tạo: đưa nhánh về `previousHead` giữ nguyên thay đổi (đã stage), trả message về ô soạn. Commit đầu tiên
 * của nhánh (không có HEAD cũ) thì xoá ref của nhánh, giữ index.
 */
export function undoCommit(
  store: RepoStore,
  previousHead: string | null,
  restore: { summary: string; body: string; amend: boolean },
): Promise<void> {
  return store.perform(
    vi.staging.undoCommit,
    async (git) => {
      if (previousHead === null) await git.undoInitialCommit();
      else await git.softReset(previousHead);
    },
    {
      refresh: Scope.all,
      onSuccess: () => {
        const draft = store.commitDraft;
        draft.summary = restore.summary;
        draft.body = restore.body;
        draft.amend = false;
        store.notify('success', vi.staging.undone);
      },
    },
  );
}
