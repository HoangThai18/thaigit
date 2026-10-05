// Khoá SSH của Thaigit: store giữ đúng view Rust trả về, lỗi chỉ hiện câu thân thiện theo mã, huỷ hộp chọn file không báo
// lỗi, kiểm tra kết nối ghi kết quả theo host.
import type { SshKeyInfo, SshKeysView } from '@thaigit/contracts';
import { describe, expect, it } from 'vitest';
import { SshKeysStore, sshErrorText, type SshKeysPort } from '../src/lib/stores/sshKeys.svelte.ts';
import { vi } from '../src/lib/strings.vi.ts';

const key: SshKeyInfo = {
  id: 'k1',
  name: 'Laptop',
  publicKey: 'ssh-ed25519 AAAA thaigit@laptop',
  fingerprint: 'SHA256:abc',
  keyType: 'Ed25519',
  encrypted: false,
  createdAt: '2026-10-05T00:00:00Z',
};

function view(keys: SshKeyInfo[] = [], enabled = true): SshKeysView {
  return { keys, enabled };
}

function port(overrides: Partial<SshKeysPort> = {}): SshKeysPort {
  const reject = () => Promise.reject(new Error('không dùng trong test này'));
  return {
    list: () => Promise.resolve(view()),
    generate: reject,
    importKey: reject,
    rename: reject,
    remove: reject,
    setEnabled: reject,
    upload: reject,
    test: reject,
    ...overrides,
  };
}

describe('khoá SSH', () => {
  it('giữ view Rust trả về sau mỗi thao tác', async () => {
    const store = new SshKeysStore(
      port({
        generate: (name) => Promise.resolve(view([{ ...key, name }])),
        setEnabled: (enabled) => Promise.resolve(view([key], enabled)),
      }),
    );
    expect(await store.generate('Máy công ty')).toBe(true);
    expect(store.view.keys.map((item) => item.name)).toEqual(['Máy công ty']);
    await store.setEnabled(false);
    expect(store.view.enabled).toBe(false);
    expect(store.error).toBeNull();
  });

  it('huỷ hộp chọn file thì không đổi gì và không báo lỗi', async () => {
    const store = new SshKeysStore(port({ importKey: () => Promise.resolve(null) }));
    expect(await store.importKey()).toBe(false);
    expect(store.error).toBeNull();
    expect(store.view.keys).toEqual([]);
  });

  it('lỗi chỉ hiện câu thân thiện theo mã, không lộ message gốc', async () => {
    const store = new SshKeysStore(
      port({ importKey: () => Promise.reject({ code: 'conflict', message: 'raw: duplicate fingerprint' }) }),
    );
    expect(await store.importKey()).toBe(false);
    expect(store.error).toBe(vi.ssh.errors.duplicate);
    expect(sshErrorText({ code: 'policy' })).toBe(vi.ssh.errors.invalid);
    expect(sshErrorText({ code: 'io' })).toBe(vi.ssh.errors.agent);
    expect(sshErrorText(new Error('stack trace'))).toBe(vi.errors.friendly.unexpected);
  });

  it('kiểm tra kết nối ghi kết quả theo từng host', async () => {
    const store = new SshKeysStore(
      port({
        test: (host) => (host === 'github.com' ? Promise.resolve('ok') : Promise.reject({ code: 'auth' })),
      }),
    );
    await store.test('github.com');
    await store.test('gitlab.com');
    expect(store.tests).toEqual({ 'github.com': 'ok', 'gitlab.com': 'failed' });
  });
});
