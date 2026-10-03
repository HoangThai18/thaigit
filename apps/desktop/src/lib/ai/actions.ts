// Mở các tính năng AI dạng markdown: giải thích một commit, viết mô tả Pull Request cho một nhánh.

import { refName, type Commit } from '@thaigit/core';
import { vi } from '../strings.vi.ts';
import { ai } from '../stores/ai.svelte.ts';
import { dialogs, textValue } from '../stores/dialogs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { explainContext, prContext } from './context.ts';
import { aiResult } from './result.svelte.ts';

export function explainCommit(store: RepoStore, commit: Commit): void {
  void aiResult.open({
    title: vi.ai.explainTitle,
    feature: 'explain',
    prepare: () => explainContext(store.git, ai, commit),
    emptyText: vi.ai.nothingToSend,
  });
}

/** Nhánh đích mặc định: main / master / develop nếu có, không thì nhánh local đầu tiên khác `head`. */
function defaultBase(names: readonly string[], head: string): string | null {
  for (const candidate of ['main', 'master', 'develop', 'dev']) {
    if (candidate !== head && names.includes(candidate)) return candidate;
  }
  return names.find((name) => name !== head) ?? null;
}

/** Hỏi nhánh đích rồi viết mô tả PR cho `head` (tên nhánh local). */
export async function describePullRequest(store: RepoStore, head: string): Promise<void> {
  const locals = store.localBranches.map(refName).filter((name) => name !== head);
  const remotes = store.remoteBranches.map(refName).filter((name) => !name.endsWith('/HEAD'));
  const options = [...locals, ...remotes];
  const base = defaultBase(options, head);
  if (base === null) {
    await dialogs.confirm({
      title: vi.ai.prBaseTitle,
      message: vi.ai.prNoChanges,
      confirmTitle: vi.ai.close,
    });
    return;
  }
  const values = await dialogs.form({
    title: vi.ai.prBaseTitle,
    message: vi.ai.prBaseMessage(head),
    fields: [
      {
        kind: 'select',
        id: 'base',
        label: vi.ai.prBaseLabel,
        value: base,
        options: options.map((name) => ({ value: name, label: name })),
      },
    ],
    confirmTitle: vi.ai.prBaseConfirm,
  });
  if (values === null) return;
  const target = textValue(values, 'base');
  void aiResult.open({
    title: vi.ai.prTitle(head),
    feature: 'pr',
    prepare: () => prContext(store.git, ai, target, head),
    emptyText: vi.ai.prNoChanges,
  });
}
