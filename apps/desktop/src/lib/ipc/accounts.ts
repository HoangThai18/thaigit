// Git accounts and Pull Request / Merge Request: every command goes through Rust (tokens never cross IPC).
import type {
  AccountsView,
  ForgeAccount,
  ForgeDeviceCode,
  ForgeMergeRequest,
  ForgePerson,
  ForgeProvider,
  ForgeRepository,
} from '@thaigit/contracts';
import { Commands } from './commands.ts';
import { call } from './invoke.ts';

// --- accounts ------------------------------------------------------------------------------------------------------

/** Signed-in accounts (no token) plus the default account and the assigned owner. */
export function accountsList(): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsList);
}

/**
 * Add an account via a personal access token / app password. Rust validates the token against the
 * host's API and only then stores it in the OS keychain; an unknown `host` requires `provider`.
 */
export function accountsAddToken(
  host: string,
  token: string,
  provider?: ForgeProvider,
): Promise<ForgeAccount> {
  return call<ForgeAccount>(Commands.accountsAddToken, { host, provider, token });
}

/**
 * Start a device-code sign-in (OAuth device flow): returns the code for the user to enter at
 * `verificationUri`. Fails with `auth` when the host has no Client ID configured — use
 * `accountsAddToken` instead.
 */
export function accountsStartLogin(
  host: string,
  provider?: ForgeProvider,
  clientId?: string,
): Promise<ForgeDeviceCode> {
  return call<ForgeDeviceCode>(Commands.accountsStartLogin, { host, provider, clientId });
}

/**
 * Poll for the token once: `null` = the user has not confirmed on the host's page yet (call again after
 * `interval` seconds); once confirmed Rust has stored the account and returns its login.
 */
export function accountsPollLogin(deviceCode: string): Promise<string | null> {
  return call<string | null>(Commands.accountsPollLogin, { deviceCode });
}

/** Close the sign-in session (dismisses the dialog) — the old code stops working. */
export function accountsCancelLogin(deviceCode: string): Promise<void> {
  return call<void>(Commands.accountsCancelLogin, { deviceCode });
}

export function accountsRemove(host: string, login: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsRemove, { host, login });
}

export function accountsSetDefault(host: string, login: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetDefault, { host, login });
}

/** Assign an owner (user / organisation) to the account; `login = null` clears the assignment (use the default account). */
export function accountsAssignOwner(
  host: string,
  owner: string,
  login: string | null,
): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsAssignOwner, { host, owner, login });
}

/** Name / email used for commits with this account (empty = the host's display name and hidden email). */
export function accountsSetIdentity(
  host: string,
  login: string,
  name: string,
  email: string,
): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetIdentity, { host, login, name, email });
}

/** OAuth App client ID for device sign-in (empty clears it). */
export function accountsSetClientId(host: string, clientId: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetClientId, { host, clientId });
}

/** Repos this account can reach (the Clone dialog). */
export function accountsRepositories(host: string, login: string): Promise<ForgeRepository[]> {
  return call<ForgeRepository[]>(Commands.accountsRepositories, { host, login });
}

// --- Pull Request / Merge Request -------------------------------------------------------------------------------

export interface ForgeRepoRef {
  host: string;
  provider?: ForgeProvider;
  owner: string;
  repo: string;
}

/** Open PRs (GitHub / Bitbucket) or open MRs (GitLab) for `owner/repo`. */
export function forgeListMergeRequests(repo: ForgeRepoRef): Promise<ForgeMergeRequest[]> {
  return call<ForgeMergeRequest[]>(Commands.forgeListMergeRequests, { repo });
}

export interface NewMergeRequest extends ForgeRepoRef {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
}

/** Create a PR / MR from the current branch; returns the newly created PR (the webview only displays it, it never guesses the state). */
export function forgeCreateMergeRequest(request: NewMergeRequest): Promise<ForgeMergeRequest> {
  return call<ForgeMergeRequest>(Commands.forgeCreateMergeRequest, { request });
}

/** People who can be assigned to a PR / MR of the repo (GitHub `assignees`, GitLab project members). */
export function forgeListAssignable(repo: ForgeRepoRef): Promise<ForgePerson[]> {
  return call<ForgePerson[]>(Commands.forgeListAssignable, { repo });
}

/** Lists a PR / MR is part of. */
export type PeopleRole = 'reviewers' | 'assignees';

export interface SetPeopleRequest extends ForgeRepoRef {
  /** PR number, or MR iid. */
  number: string;
  role: PeopleRole;
  /** NEW lists (replacing the old ones); empty removes them all. */
  people: ForgePerson[];
}

/** Replace reviewers / assignees; returns the PR / MR re-read from the host (the webview never assumes the outcome). */
export function forgeSetPeople(request: SetPeopleRequest): Promise<ForgeMergeRequest> {
  return call<ForgeMergeRequest>(Commands.forgeSetPeople, { request });
}
