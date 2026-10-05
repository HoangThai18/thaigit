// The Git name / email used for commits (the toolbar Profile, like GitKraken): read the repo's currently effective config and
// change it — for this repo alone (local) or for every repo on the machine (global). Written through the typed command `git_config_set` (the key is in the allowlist).

import { vi } from '../strings.vi.ts';
import { dialogs as globalDialogs, textValue, type DialogStore } from '../stores/dialogs.svelte.ts';
import type { RepoStore } from '../stores/repo.svelte.ts';

export interface GitIdentity {
  readonly name: string | null;
  readonly email: string | null;
}

export async function loadIdentity(store: RepoStore): Promise<GitIdentity> {
  const [name, email] = await Promise.all([
    store.git.config('user.name').catch(() => null),
    store.git.config('user.email').catch(() => null),
  ]);
  return { name: name?.trim() || null, email: email?.trim() || null };
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The dialog for changing the Git name & email. `true` when it was saved. */
export async function editIdentity(
  store: RepoStore,
  current: GitIdentity,
  dialogs: DialogStore = globalDialogs,
): Promise<boolean> {
  const values = await dialogs.form({
    title: vi.window.identityTitle,
    message: vi.window.identityMessage,
    confirmTitle: vi.window.identitySave,
    fields: [
      { kind: 'text', id: 'name', label: vi.window.identityName, value: current.name ?? '' },
      { kind: 'text', id: 'email', label: vi.window.identityEmail, value: current.email ?? '' },
      {
        kind: 'select',
        id: 'scope',
        label: vi.window.identityScope,
        value: 'local',
        options: [
          { value: 'local', label: vi.window.identityLocal },
          { value: 'global', label: vi.window.identityGlobal },
        ],
      },
    ],
    validate: (draft) => {
      if (textValue(draft, 'name').trim() === '') return vi.window.identityNeedName;
      if (!EMAIL.test(textValue(draft, 'email').trim())) return vi.window.identityBadEmail;
      return null;
    },
  });
  if (!values) return false;
  const name = textValue(values, 'name').trim();
  const email = textValue(values, 'email').trim();
  const scope = textValue(values, 'scope') === 'global' ? 'global' : 'local';
  let saved = false;
  await store.perform(
    vi.window.identityTitle,
    async (git) => {
      await git.setConfig('user.name', name, scope);
      await git.setConfig('user.email', email, scope);
      saved = true;
    },
    { refresh: 0, onSuccess: () => store.notify('success', vi.window.identitySaved(name, email)) },
  );
  return saved;
}
