// Hộp thoại tạo Pull Request / Merge Request: nhánh đích, tiêu đề, mô tả (có nút viết bằng AI), nháp. Một hộp tại một
// thời điểm; mọi chữ do máy chủ trả về đều hiển thị dạng text.

import type { ForgeMergeRequest, ForgeProvider } from '@thaigit/contracts';
import { finalizeMarkdown, refName, stripThinking } from '@thaigit/core';
import { prContext } from '../ai/context.ts';
import { friendlyError } from '../errors/friendly.ts';
import { forgeCreateMergeRequest } from '../ipc/accounts.ts';
import { ai as defaultAi, type AiStore } from '../stores/ai.svelte.ts';
import { forgeErrorText } from '../stores/accounts.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { toasts } from '../stores/toasts.svelte.ts';
import { vi } from '../strings.vi.ts';
import { targetOf } from './pullRequests.ts';
import { requestWording } from './wording.ts';

const text = vi.pullRequests;

/** Nhánh đích mặc định: main / master / develop / dev nếu có, không thì nhánh đầu tiên. */
export function defaultBase(names: readonly string[]): string | null {
  for (const candidate of ['main', 'master', 'develop', 'dev']) {
    if (names.includes(candidate)) return candidate;
  }
  return names[0] ?? null;
}

/** Tên các nhánh trên `remote` (bỏ tiền tố `remote/` và `HEAD`). */
export function branchesOnRemote(store: RepoStore, remote: string): string[] {
  const prefix = `${remote}/`;
  return store.remoteBranches
    .map(refName)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .filter((name) => name !== '' && name !== 'HEAD');
}

/**
 * Tên nhánh `local` trên `remote` (đầu PR phải là nhánh đã push): upstream của nó nếu upstream nằm ở remote đó, không thì
 * nhánh cùng tên; `null` = chưa push.
 */
export function pushedName(store: RepoStore, remote: string, local: string): string | null {
  const ref = store.localBranches.find((branch) => refName(branch) === local);
  const upstream = ref?.upstream ? store.splitUpstream(ref.upstream) : null;
  const onRemote = branchesOnRemote(store, remote);
  if (upstream && upstream.remote === remote && onRemote.includes(upstream.branch)) return upstream.branch;
  return onRemote.includes(local) ? local : null;
}

export interface CreateState {
  store: RepoStore;
  /** Remote chứa repo trên máy chủ (`origin`…) — dùng để so diff với nhánh đích khi viết mô tả. */
  remote: string;
  provider: ForgeProvider | null;
  /** Nhánh nguồn trên remote. */
  sourceBranch: string;
  bases: readonly string[];
  base: string;
  title: string;
  body: string;
  draft: boolean;
  submitting: boolean;
  writing: boolean;
  error: string | null;
}

export class CreatePullRequestStore {
  // `$state` sâu: hộp thoại sửa từng trường (tiêu đề, mô tả đang viết dần…) và giao diện phải thấy ngay.
  current = $state<CreateState | null>(null);
  readonly #ai: AiStore;
  #writing: AbortController | null = null;

  constructor(ai: AiStore = defaultAi) {
    this.#ai = ai;
  }

  close(): void {
    this.#writing?.abort();
    this.#writing = null;
    this.current = null;
  }

  /**
   * Mở hộp tạo PR từ nhánh local `head`. `false` (kèm thông báo) khi repo không nói chuyện với máy chủ app nhận ra, nhánh
   * chưa push, hoặc remote không có nhánh đích nào khác.
   */
  async open(store: RepoStore, head: string): Promise<boolean> {
    const target = targetOf(store);
    if (target === null) {
      toasts.error(text.notConnected);
      return false;
    }
    const source = pushedName(store, target.remote, head);
    if (source === null) {
      toasts.error(requestWording(target.provider).notPushed(head));
      return false;
    }
    const bases = branchesOnRemote(store, target.remote).filter((name) => name !== source);
    const base = defaultBase(bases);
    if (base === null) {
      toasts.error(text.noBase);
      return false;
    }
    const remote = target.remote;
    const title = await store.git
      .recentSubjects(1, `${remote}/${source}`, `${remote}/${base}`)
      .then((subjects) => subjects[0] ?? '')
      .catch(() => '');
    this.close();
    this.current = {
      store,
      remote,
      provider: target.provider,
      sourceBranch: source,
      bases,
      base,
      title,
      body: '',
      draft: false,
      submitting: false,
      writing: false,
      error: null,
    };
    return true;
  }

  setBase(base: string): void {
    if (this.current !== null) this.current.base = base;
  }

  setTitle(title: string): void {
    if (this.current !== null) this.current.title = title;
  }

  setBody(body: string): void {
    if (this.current !== null) this.current.body = body;
  }

  setDraft(draft: boolean): void {
    if (this.current !== null) this.current.draft = draft;
  }

  /** Mô tả bằng AI từ diff + commit giữa nhánh đích và nhánh nguồn (trên remote); hỏi đồng ý nếu chưa đồng ý. */
  async writeDescription(): Promise<void> {
    const current = this.current;
    if (current === null || current.writing) return;
    current.writing = true;
    current.error = null;
    const controller = new AbortController();
    this.#writing = controller;
    try {
      const prepared = await prContext(
        current.store.git,
        this.#ai,
        `${current.remote}/${current.base}`,
        `${current.remote}/${current.sourceBranch}`,
      );
      if (prepared === null) {
        current.error = vi.ai.prNoChanges;
        return;
      }
      if (!(await this.#ai.askConsent(prepared.preview))) return;
      let raw = '';
      for await (const frame of this.#ai.run('pr', prepared.request, controller.signal)) {
        if (frame.type === 'delta') {
          raw += frame.text;
          // Chữ hiện dần trong ô mô tả (chỉ hiển thị, không gửi gì khi chưa bấm Tạo).
          current.body = stripThinking(raw).trimStart();
        } else if (frame.type === 'done') {
          current.body = finalizeMarkdown(raw);
          return;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) current.error = friendlyError(error);
    } finally {
      current.writing = false;
      if (this.#writing === controller) this.#writing = null;
      controller.abort();
    }
  }

  /** Gửi tạo PR; đóng hộp khi thành công, giữ hộp khi lỗi để người dùng sửa. */
  async submit(onCreated?: (item: ForgeMergeRequest) => void): Promise<void> {
    const current = this.current;
    if (current === null || current.submitting) return;
    const target = targetOf(current.store);
    if (target === null) {
      current.error = text.notConnected;
      return;
    }
    if (current.title.trim() === '') {
      current.error = text.needsTitle;
      return;
    }
    if (current.base === current.sourceBranch) {
      current.error = text.sameBranch;
      return;
    }
    current.submitting = true;
    current.error = null;
    try {
      const created = await forgeCreateMergeRequest({
        host: target.host,
        provider: target.provider ?? undefined,
        owner: target.owner,
        repo: target.repo,
        title: current.title.trim(),
        body: current.body,
        sourceBranch: current.sourceBranch,
        targetBranch: current.base,
        draft: current.draft,
      });
      toasts.success(requestWording(target.provider).createdToast(created.number));
      this.close();
      onCreated?.(created);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      current.error = code === 'conflict' ? requestWording(target.provider).rejected : forgeErrorText(error);
    } finally {
      current.submitting = false;
    }
  }
}

export const createPullRequest = new CreatePullRequestStore();
