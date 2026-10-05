// Khoá SSH riêng của Thaigit: khoá bí mật chỉ nằm trong Rust + kho bí mật của hệ điều hành, webview chỉ thấy khoá công khai.
import type { SshKeysView, SshUploadResult } from '@thaigit/contracts';
import { Commands } from './commands.ts';
import { call } from './invoke.ts';

export function sshKeysList(): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysList);
}

/** Tạo khoá Ed25519 mới. */
export function sshKeysGenerate(name: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysGenerate, { name });
}

/** Rust mở hộp chọn file khoá rồi nhập; `null` khi người dùng huỷ. */
export function sshKeysImport(): Promise<SshKeysView | null> {
  return call<SshKeysView | null>(Commands.sshKeysImport);
}

export function sshKeysRename(id: string, name: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysRename, { id, name });
}

export function sshKeysRemove(id: string): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysRemove, { id });
}

export function sshKeysSetEnabled(enabled: boolean): Promise<SshKeysView> {
  return call<SshKeysView>(Commands.sshKeysSetEnabled, { enabled });
}

/** Gửi khoá công khai lên tài khoản đã đăng nhập (`host` + `login`). */
export function sshKeysUpload(id: string, host: string, login: string): Promise<SshUploadResult> {
  return call<SshUploadResult>(Commands.sshKeysUpload, { id, host, login });
}

/** `ssh -T git@<host>` bằng khoá của Thaigit — thành công thì trả câu chào. */
export function sshKeysTest(host: string): Promise<string> {
  return call<string>(Commands.sshKeysTest, { host });
}
