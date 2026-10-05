// Ảnh đại diện người commit cho node graph: store hỏi Rust một lần mỗi email, giữ ảnh đã giải mã và báo
// `version` để canvas vẽ lại. Không có `Image` trong vitest nên phần giải mã bị bỏ qua — chỉ kiểm phần logic
// (gộp email, không hỏi lại, không hỏi email rác).
import { describe, expect, it } from 'vitest';
import { AvatarStore, avatarKey } from '../src/lib/graph/avatars.svelte.ts';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('avatarKey', () => {
  it('chuẩn hoá y như Rust để cùng một người chỉ có một mục', () => {
    expect(avatarKey('  A@B.C ')).toBe('a@b.c');
    expect(avatarKey('a@b.c')).toBe(avatarKey('A@B.C'));
  });
});

describe('AvatarStore', () => {
  it('một email chỉ được hỏi một lần, kể cả khi nhiều hàng cùng tác giả', async () => {
    const asked: string[] = [];
    const store = new AvatarStore(async (email) => {
      asked.push(email);
      return null;
    });
    store.ensure('a@b.c');
    store.ensure(' a@b.c ');
    store.ensure('d@e.f');
    await settle();
    store.ensure('a@b.c');
    await settle();
    expect(asked).toEqual(['a@b.c', 'd@e.f']);
  });

  it('email không phải địa chỉ thì không hỏi ai', async () => {
    const asked: string[] = [];
    const store = new AvatarStore(async (email) => {
      asked.push(email);
      return null;
    });
    store.ensure('không phải email');
    store.ensure('');
    await settle();
    expect(asked).toEqual([]);
  });

  it('lỗi của cổng tải không được ghi thành "không có ảnh": lần sau còn thử lại', async () => {
    let calls = 0;
    const store = new AvatarStore(async () => {
      calls += 1;
      throw new Error('mạng hỏng');
    });
    store.ensure('a@b.c');
    await settle();
    store.ensure('a@b.c');
    await settle();
    expect(calls).toBe(2);
  });

  it('không có ảnh thì `image` trả null, `version` không đổi', async () => {
    const store = new AvatarStore(async () => null);
    store.ensure('a@b.c');
    await settle();
    expect(store.image('a@b.c')).toBeNull();
    expect(store.version).toBe(0);
  });
});
