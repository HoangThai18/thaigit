// Lệnh git CÓ KIỂU trên Node (`TypedGit`): không đi qua `NodeExec`/validator vì validator chặn chúng (ghi cấu hình tuỳ ý,
// URL remote là chỗ chạy lệnh). Mỗi lệnh tự kiểm đầu vào theo chính sách: khoá config thuộc `configSetAllowlist`,
// URL không phải `ext::`/`fd::`/bắt đầu bằng `-`, tên remote không thể bị hiểu thành cờ.

import { buildGitArgv, gitPolicy, type PolicyViolation } from '@thaigit/contracts';
import { decodeUtf8 } from '../git/bytes.ts';
import { AdapterError, GitError } from '../git/runner.ts';
import type { TypedGit } from '../ports/index.ts';
import { gitEnvFor, spawnGit, type NodeGitConfig } from './process.ts';

export interface NodeTypedGitOptions extends NodeGitConfig {
  /** Gốc working tree của repo (thư mục chạy git). */
  cwd: string;
}

function policyError(message: string, violation: PolicyViolation): AdapterError {
  return new AdapterError('policy', message, violation);
}

/** Khoá có khớp một mục allowlist không (`*` = một hay nhiều ký tự, ví dụ `branch.*.remote`; không phân biệt hoa thường). */
export function isAllowedConfigKey(key: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(key)) return false;
  const lower = key.toLowerCase();
  return gitPolicy.configSetAllowlist.some((pattern) => {
    const regex = new RegExp(`^${pattern.toLowerCase().split('*').map(escapeRegExp).join('.+')}$`);
    return regex.test(lower);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** URL remote an toàn để lưu vào cấu hình/đưa cho git: loại `ext::`, `fd::`, bắt đầu bằng `-`, khoảng trắng đầu/cuối, ký tự điều khiển. */
export function assertSafeRemoteUrl(url: string, sub: string): void {
  const lower = url.toLowerCase();
  const reject = (detail: string): never => {
    throw policyError(`URL remote bị chính sách chặn: ${detail}`, { code: 'url-rejected', sub, detail: url });
  };
  if (url === '' || url !== url.trim() || /[\u0000-\u001f\u007f]/.test(url))
    reject('URL rỗng hoặc chứa khoảng trắng/ký tự điều khiển');
  if (gitPolicy.url.rejectPrefixes.some((prefix) => lower.startsWith(prefix)))
    reject('tiền tố không được phép');
  const scheme = /^([a-z][a-z0-9+.-]*)::/.exec(lower)?.[1];
  if (scheme !== undefined && gitPolicy.url.rejectSchemes.includes(scheme))
    reject(`transport "${scheme}" không được phép`);
}

function assertSafeRemoteName(name: string, sub: string): void {
  if (name === '' || name.startsWith('-') || /[\s\u0000-\u001f\u007f]/.test(name)) {
    throw policyError(`Tên remote không hợp lệ: ${JSON.stringify(name)}`, {
      code: 'flag-rejected',
      sub,
      detail: name,
    });
  }
}

export class NodeTypedGit implements TypedGit {
  constructor(private readonly options: NodeTypedGitOptions) {}

  async configSet(key: string, value: string, scope: 'local' | 'global'): Promise<void> {
    if (!isAllowedConfigKey(key)) {
      throw policyError(`Khoá cấu hình "${key}" không nằm trong danh sách cho phép.`, {
        code: 'config-write',
        sub: 'config',
      });
    }
    if (value.includes('\0'))
      throw policyError('Giá trị cấu hình chứa ký tự NUL.', { code: 'config-write', sub: 'config' });
    // `branch.*.remote` nhận cả URL: áp luật URL để không đặt được transport chạy lệnh.
    if (key.toLowerCase().endsWith('.remote')) assertSafeRemoteUrl(value, 'config');
    await this.run('config', [scope === 'global' ? '--global' : '--local', key, value]);
  }

  async remoteAdd(name: string, url: string): Promise<void> {
    assertSafeRemoteName(name, 'remote');
    assertSafeRemoteUrl(url, 'remote');
    await this.run('remote', ['add', '--', name, url]);
  }

  async remoteSetUrl(name: string, url: string): Promise<void> {
    assertSafeRemoteName(name, 'remote');
    assertSafeRemoteUrl(url, 'remote');
    await this.run('remote', ['set-url', '--', name, url]);
  }

  private async run(sub: string, args: readonly string[]): Promise<void> {
    const result = await spawnGit({
      ...this.options,
      argv: buildGitArgv(sub, args),
      cwd: this.options.cwd,
      env: gitEnvFor(this.options, 'interactive'),
      cancellable: false,
    });
    if (result.code !== 0)
      throw new GitError([sub, ...args], result.code, decodeUtf8(result.stdout), decodeUtf8(result.stderr));
  }
}
