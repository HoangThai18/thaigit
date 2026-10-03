// Tài khoản git (GitHub / GitLab / Bitbucket): danh sách đăng nhập, đăng nhập bằng mã, gán owner cho repo. Mọi thao tác
// đi qua Rust; token không bao giờ vào webview. Store giữ `AccountsView` mà Rust trả về (nguồn sự thật duy nhất).

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

/** Máy chủ chính thức của provider — hộp thoại đăng nhập mặc định là GitHub. */
export function hostOfProvider(provider: ForgeProvider): string {
  return KNOWN_FORGE_HOSTS[provider];
}

/** Câu thân thiện cho lỗi khi gọi máy chủ (chỉ theo mã lỗi của Rust, không hiện message gốc). */
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

/** `host/owner` → login (khoá trong `ownerAssignments` của Rust). */
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
  /** Đăng nhập bằng mã đang chờ: mã người dùng nhập + device code (bí mật tạm, hết hạn cùng mã). */
  login = $state<{
    host: string;
    provider: ForgeProvider | null;
    userCode: string;
    verificationUri: string;
    deviceCode: string;
  } | null>(null);
  /** Thông báo lỗi thân thiện (không hiện message gốc của Rust). */
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

  /** Tài khoản app chọn cho owner này (khớp quy tắc `resolve` của Rust: gán tay → trùng login → tổ chức → mặc định). */
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

  /** Host nào có ít nhất một tài khoản (dùng cho hộp thoại PR: repo nào đọc được PR). */
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
   * Người dùng chọn repo trong danh sách của tài khoản `login`: gán owner cho tài khoản đó nếu app đang chọn tài khoản khác,
   * để clone / fetch / push sau này dùng đúng token.
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
   * Bắt đầu đăng nhập bằng mã (OAuth device flow): hiện mã cho người dùng nhập ở trang của máy chủ, rồi hỏi Rust theo nhịp
   * `interval` của máy chủ cho tới khi xong / lỗi / huỷ. `onDone(login)` khi tài khoản đã được lưu. Lỗi → `error`.
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

  /** Đóng hộp thoại đăng nhập: ngừng hỏi, mã cũ không dùng được nữa. */
  cancelLogin(): void {
    this.#serial += 1;
    if (this.#poller !== null) this.#timers.clearTimeout(this.#poller);
    this.#poller = null;
    if (this.login !== null) void this.#port.cancelLogin(this.login.deviceCode).catch(() => undefined);
    this.login = null;
  }

  /** Chạy một lệnh: bật `busy`, đổi `error` khi hỏng, luôn tắt `busy`. */
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

/** Hẹn giờ của store (test thay bằng đồng hồ giả). */
export interface Timers {
  setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const globalTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export const accounts = new AccountsStore();
