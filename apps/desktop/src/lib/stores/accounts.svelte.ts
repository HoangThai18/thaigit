// Git accounts (GitHub / GitLab / Bitbucket): the signed-in list, device-flow sign-in, assigning an owner to a repo.
// Every operation goes through Rust; a token never reaches the webview. The store holds the `AccountsView` Rust returns
// (the single source of truth).

import {
  KNOWN_FORGE_HOSTS,
  type AccountsView,
  type ForgeAccount,
  type ForgeDeviceCode,
  type ForgeProvider,
} from '@thaigit/contracts';
import {
  accountsAddToken,
  accountsAssignOwner,
  accountsCancelLogin,
  accountsList,
  accountsPollLogin,
  accountsRemove,
  accountsSetClientId,
  accountsSetDefault,
  accountsSetIdentity,
  accountsStartLogin,
} from '../ipc/accounts.ts';
import { vi } from '../strings.vi.ts';

const EMPTY: AccountsView = { accounts: [], defaults: {}, ownerAssignments: {}, oauthClientIds: {} };

/** The provider's canonical host — the sign-in dialog defaults to GitHub. */
export function hostOfProvider(provider: ForgeProvider): string {
  return KNOWN_FORGE_HOSTS[provider];
}

/** A friendly sentence for a host call error (based only on Rust's error code, never the raw message). */
export function forgeErrorText(error: unknown): string {
  const text = vi.accounts.errors;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'auth') return text.auth;
  if (code === 'not-found') return text.notFound;
  if (code === 'io') return text.network;
  if (code === 'conflict') return text.rejected;
  if (code === 'busy') return text.busy;
  if (code === 'policy') return text.invalid;
  return vi.errors.friendly.unexpected;
}

/** `host/owner` → login (the key in Rust's `ownerAssignments`). */
export function ownerKey(host: string, owner: string): string {
  return `${host.toLowerCase()}/${owner.toLowerCase()}`;
}

export interface AccountsPort {
  list(): Promise<AccountsView>;
  addToken(host: string, token: string, provider?: ForgeProvider): Promise<ForgeAccount>;
  startLogin(host: string, provider?: ForgeProvider, clientId?: string): Promise<ForgeDeviceCode>;
  pollLogin(deviceCode: string): Promise<string | null>;
  cancelLogin(deviceCode: string): Promise<void>;
  remove(host: string, login: string): Promise<AccountsView>;
  setDefault(host: string, login: string): Promise<AccountsView>;
  assignOwner(host: string, owner: string, login: string | null): Promise<AccountsView>;
  setIdentity(host: string, login: string, name: string, email: string): Promise<AccountsView>;
  setClientId(host: string, clientId: string): Promise<AccountsView>;
}

export const defaultAccountsPort: AccountsPort = {
  list: accountsList,
  addToken: accountsAddToken,
  startLogin: accountsStartLogin,
  pollLogin: accountsPollLogin,
  cancelLogin: accountsCancelLogin,
  remove: accountsRemove,
  setDefault: accountsSetDefault,
  assignOwner: accountsAssignOwner,
  setIdentity: accountsSetIdentity,
  setClientId: accountsSetClientId,
};

export class AccountsStore {
  view = $state.raw<AccountsView>(EMPTY);
  loading = $state(false);
  /** The pending device-flow sign-in: the code the user types plus the device code (a temporary secret that expires with it). */
  login = $state<{
    host: string;
    provider: ForgeProvider | null;
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);
  /** A friendly error message (never Rust's raw message). */
  error = $state<string | null>(null);
  busy = $state(false);

  readonly #port: AccountsPort;
  readonly #timers: Timers;
  #poller: ReturnType<typeof setTimeout> | null = null;
  #serial = 0;

  constructor(port: AccountsPort = defaultAccountsPort, timers: Timers = globalTimers) {
    this.#port = port;
    this.#timers = timers;
  }

  accountsFor(host: string): ForgeAccount[] {
    return this.view.accounts.filter((account) => account.host === host.toLowerCase());
  }

  defaultLoginFor(host: string): string | null {
    return this.view.defaults[host.toLowerCase()] ?? null;
  }

  /** The account the app picked for this owner (matching Rust's `resolve` rule: manual assignment → matching login → organisation → default). */
  loginForOwner(host: string, owner: string): string | null {
    const key = ownerKey(host, owner);
    const assigned = this.view.ownerAssignments[key];
    if (
      assigned &&
      this.accountsFor(host).some((account) => account.login.toLowerCase() === assigned.toLowerCase())
    ) {
      return assigned;
    }
    const accounts = this.accountsFor(host);
    const own = accounts.find((account) => account.login.toLowerCase() === owner.toLowerCase());
    if (own) return own.login;
    const organization = accounts.find((account) =>
      account.organizations.some((name) => name.toLowerCase() === owner.toLowerCase()),
    );
    return organization?.login ?? this.defaultLoginFor(host);
  }

  clientIdFor(host: string): string {
    return this.view.oauthClientIds[host.toLowerCase()] ?? '';
  }

  /** Which hosts have at least one account (for the PR dialog: which repos' PRs can be read). */
  hostsWithAccounts(): string[] {
    return [...new Set(this.view.accounts.map((account) => account.host))];
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.view = await this.#port.list();
    } finally {
      this.loading = false;
    }
  }

  async addToken(host: string, token: string, provider: ForgeProvider | null): Promise<ForgeAccount | null> {
    return this.#run(async () => {
      const account = await this.#port.addToken(host, token, provider ?? undefined);
      await this.refresh();
      return account;
    });
  }

  async remove(host: string, login: string): Promise<void> {
    await this.#run(async () => {
      this.view = await this.#port.remove(host, login);
    });
  }

  async setDefault(host: string, login: string): Promise<void> {
    await this.#run(async () => {
      this.view = await this.#port.setDefault(host, login);
    });
  }

  async assignOwner(host: string, owner: string, login: string | null): Promise<void> {
    await this.#run(async () => {
      this.view = await this.#port.assignOwner(host, owner, login);
    });
  }

  /**
   * The user picks a repo from account `login`'s list: assign the owner to that account when the app is using a different
   * one, so a later clone / fetch / push uses the right token.
   */
  async ensureOwnerUses(host: string, owner: string, login: string): Promise<void> {
    if (this.loginForOwner(host, owner)?.toLowerCase() === login.toLowerCase()) return;
    await this.assignOwner(host, owner, login);
  }

  async setIdentity(host: string, login: string, name: string, email: string): Promise<void> {
    await this.#run(async () => {
      this.view = await this.#port.setIdentity(host, login, name, email);
    });
  }

  async setClientId(host: string, clientId: string): Promise<void> {
    await this.#run(async () => {
      this.view = await this.#port.setClientId(host, clientId);
    });
  }

  /**
   * Start a device-flow (OAuth) sign-in: show the code for the user to enter on the host's page, then poll Rust at the host's
   * `interval` until it succeeds / fails / is cancelled. `onDone(login)` once the account is stored. An error → `error`.
   */
  async startLogin(
    host: string,
    provider: ForgeProvider | null,
    onDone: (login: string) => void,
  ): Promise<boolean> {
    this.cancelLogin();
    const code = await this.#run(() =>
      this.#port.startLogin(host, provider ?? undefined, this.clientIdFor(host) || undefined),
    );
    if (code === null) return false;
    const serial = ++this.#serial;
    this.login = {
      host,
      provider,
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      deviceCode: code.deviceCode,
    };
    const every = Math.min(Math.max(code.interval, 1), 30) * 1000;
    const poll = async (): Promise<void> => {
      this.#poller = null;
      if (serial !== this.#serial) return;
      let login: string | null;
      try {
        login = await this.#port.pollLogin(code.deviceCode);
      } catch (error) {
        if (serial !== this.#serial) return;
        this.login = null;
        this.error = forgeErrorText(error);
        return;
      }
      if (serial !== this.#serial) return;
      if (login === null) {
        this.#poller = this.#timers.setTimeout(() => void poll(), every);
        return;
      }
      this.login = null;
      await this.refresh().catch(() => undefined);
      onDone(login);
    };
    this.#poller = this.#timers.setTimeout(() => void poll(), every);
    return true;
  }

  /** Close the sign-in dialog: stop polling, and the old code can no longer be used. */
  cancelLogin(): void {
    this.#serial += 1;
    if (this.#poller !== null) this.#timers.clearTimeout(this.#poller);
    this.#poller = null;
    if (this.login !== null) void this.#port.cancelLogin(this.login.deviceCode).catch(() => undefined);
    this.login = null;
  }

  /** Run one command: set `busy`, set `error` on failure, always clear `busy`. */
  async #run<T>(action: () => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = null;
    try {
      return await action();
    } catch (error) {
      this.error = forgeErrorText(error);
      return null;
    } finally {
      this.busy = false;
    }
  }
}

/** The store's timers (tests substitute a fake clock). */
export interface Timers {
  setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const globalTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export const accounts = new AccountsStore();
