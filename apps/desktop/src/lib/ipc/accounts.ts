// Tài khoản git và Pull Request / Merge Request: mọi lệnh đều gọi Rust (token không bao giờ đi qua IPC).
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

// --- tài khoản ------------------------------------------------------------------------------------------------------

/** Tài khoản đã đăng nhập (không token) + tài khoản mặc định + owner đã gán. */
export function accountsList(): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsList);
}

/**
 * Thêm tài khoản bằng Personal access token / app password. Rust kiểm token với API của máy chủ rồi mới lưu vào kho bí
 * mật của hệ điều hành; `host` lạ thì phải khai `provider`.
 */
export function accountsAddToken(
  host: string,
  token: string,
  provider?: ForgeProvider,
): Promise<ForgeAccount> {
  return call<ForgeAccount>(Commands.accountsAddToken, { host, provider, token });
}

/**
 * Bắt đầu đăng nhập bằng mã (OAuth device flow): trả mã để người dùng nhập ở `verificationUri`. Máy chủ chưa có Client ID
 * thì lỗi `auth` — dùng `accountsAddToken`.
 */
export function accountsStartLogin(
  host: string,
  provider?: ForgeProvider,
  clientId?: string,
): Promise<ForgeDeviceCode> {
  return call<ForgeDeviceCode>(Commands.accountsStartLogin, { host, provider, clientId });
}

/**
 * Hỏi token một lần: `null` = người dùng chưa xác nhận ở trang máy chủ (gọi lại sau `interval` giây); xong thì Rust đã lưu
 * tài khoản và trả login của nó.
 */
export function accountsPollLogin(deviceCode: string): Promise<string | null> {
  return call<string | null>(Commands.accountsPollLogin, { deviceCode });
}

/** Đóng phiên đăng nhập (đóng hộp thoại) — mã cũ không dùng được nữa. */
export function accountsCancelLogin(deviceCode: string): Promise<void> {
  return call<void>(Commands.accountsCancelLogin, { deviceCode });
}

export function accountsRemove(host: string, login: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsRemove, { host, login });
}

export function accountsSetDefault(host: string, login: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetDefault, { host, login });
}

/** Gán owner (user / tổ chức) cho tài khoản; `login = null` bỏ gán (dùng tài khoản mặc định). */
export function accountsAssignOwner(
  host: string,
  owner: string,
  login: string | null,
): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsAssignOwner, { host, owner, login });
}

/** Tên / email dùng cho commit với tài khoản này (rỗng = tên hiển thị và email ẩn của máy chủ). */
export function accountsSetIdentity(
  host: string,
  login: string,
  name: string,
  email: string,
): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetIdentity, { host, login, name, email });
}

/** Client ID của OAuth App cho đăng nhập bằng mã (rỗng = xoá). */
export function accountsSetClientId(host: string, clientId: string): Promise<AccountsView> {
  return call<AccountsView>(Commands.accountsSetClientId, { host, clientId });
}

/** Repo tài khoản này truy cập được (hộp Clone). */
export function accountsRepositories(host: string, login: string): Promise<ForgeRepository[]> {
  return call<ForgeRepository[]>(Commands.accountsRepositories, { host, login });
}

// --- Pull Request / Merge Request ----------------------------------------------------------------------------------

export interface ForgeRepoRef {
  host: string;
  provider?: ForgeProvider;
  owner: string;
  repo: string;
}

/** PR đang mở (GitHub / Bitbucket) hoặc MR đang mở (GitLab) của `owner/repo`. */
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

/** Tạo PR / MR từ nhánh hiện tại; trả PR vừa tạo (webview chỉ hiện, không tự đoán trạng thái). */
export function forgeCreateMergeRequest(request: NewMergeRequest): Promise<ForgeMergeRequest> {
  return call<ForgeMergeRequest>(Commands.forgeCreateMergeRequest, { request });
}

/** Người có thể gán vào PR / MR của repo (GitHub `assignees`, GitLab thành viên project). */
export function forgeListAssignable(repo: ForgeRepoRef): Promise<ForgePerson[]> {
  return call<ForgePerson[]>(Commands.forgeListAssignable, { repo });
}

/** Danh sách nào của PR / MR đang sửa. */
export type PeopleRole = 'reviewers' | 'assignees';

export interface SetPeopleRequest extends ForgeRepoRef {
  /** Số PR / iid của MR. */
  number: string;
  role: PeopleRole;
  /** Danh sách MỚI (thay hẳn danh sách cũ); rỗng là bỏ hết. */
  people: ForgePerson[];
}

/** Đặt lại người review / người được gán; trả PR / MR đọc lại từ máy chủ (webview không tự đoán kết quả). */
export function forgeSetPeople(request: SetPeopleRequest): Promise<ForgeMergeRequest> {
  return call<ForgeMergeRequest>(Commands.forgeSetPeople, { request });
}
