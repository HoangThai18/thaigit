// Gán tài khoản cho owner của repo (chọn trong menu "Tài khoản cho repo này"): lệnh git tới repo đó sẽ dùng đúng token,
// nên người dùng làm việc được với cả repo cá nhân và repo công ty mà không phải đổi cấu hình. Chọn xong thì đề nghị ghi
// tên / email commit của tài khoản đó vào cấu hình của repo.

import type { ForgeAccount } from '@thaigit/contracts';
import { accounts as globalAccounts, type AccountsStore } from '../stores/accounts.svelte.ts';
import { dialogs, type DialogStore } from '../stores/dialogs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';
import { settingsStore } from '../stores/settings.svelte.ts';
import { toasts } from '../stores/toasts.svelte.ts';
import { vi } from '../strings.vi.ts';
import { targetOf } from './pullRequests.ts';

const text = vi.accounts;

/**
 * Hỏi tài khoản nào dùng cho owner của repo `store`, rồi lưu vào Rust. `false` = Huỷ / lỗi.
 * Repo không nói chuyện với máy chủ app nhận ra, hoặc chưa có tài khoản nào trên máy chủ đó: mở Cài đặt (mục Tài khoản).
 */
export async function assignAccountForRepo(
  store: RepoStore,
  accounts: AccountsStore = globalAccounts,
  prompts: DialogStore = dialogs,
): Promise<boolean> {
  const target = targetOf(store);
  await accounts.refresh().catch(() => undefined);
  const list = target === null ? [] : accounts.accountsFor(target.host);
  if (target === null || list.length === 0) {
    settingsStore.open();
    if (target !== null) toasts.info(text.empty);
    return false;
  }
  const assigned = accounts.view.ownerAssignments[`${target.host}/${target.owner.toLowerCase()}`] ?? '';
  const values = await prompts.form({
    title: text.ownerForRepo,
    message: `${target.owner}/${target.repo} · ${target.host}\n${text.ownerHelp}`,
    fields: [
      {
        kind: 'select',
        id: 'login',
        label: text.owner,
        value: assigned,
        options: [
          { value: '', label: text.ownerNone },
          ...list.map((account) => ({ value: account.login, label: account.login })),
        ],
      },
    ],
    confirmTitle: text.identitySave,
  });
  if (values === null) return false;
  const chosen = typeof values.login === 'string' ? values.login : '';
  await accounts.assignOwner(target.host, target.owner, chosen === '' ? null : chosen);
  if (accounts.error !== null) {
    toasts.error(accounts.error);
    return false;
  }
  const used = accounts.loginForOwner(target.host, target.owner);
  toasts.success(used === null ? text.noAccountForOwner(target.owner) : text.usedAccount(target.owner, used));
  const account = list.find((item) => item.login === used);
  if (account) await offerIdentity(store, account, prompts);
  return true;
}

/** Tên / email commit của repo khác của tài khoản: hỏi có ghi vào cấu hình repo không (commit mới tính cho tài khoản đó). */
async function offerIdentity(store: RepoStore, account: ForgeAccount, prompts: DialogStore): Promise<void> {
  const name = account.commitName.trim();
  const email = account.commitEmail.trim();
  if (name === '' || email === '') return;
  const [currentName, currentEmail] = await Promise.all([
    store.git.config('user.name').catch(() => null),
    store.git.config('user.email').catch(() => null),
  ]);
  if (currentName === name && currentEmail === email) return;
  const ok = await prompts.confirm({
    title: text.identityForRepo,
    message: text.identityForRepoMessage(name, email),
    confirmTitle: text.identityWrite,
  });
  if (!ok) return;
  await store.perform(text.identityForRepo, async (git) => {
    await git.setConfig('user.name', name, 'local');
    await git.setConfig('user.email', email, 'local');
  });
}
