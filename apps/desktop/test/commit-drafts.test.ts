// Bản nháp commit theo repo (localStorage) và bộ lọc của hộp "Chuyển nhánh".
import { describe, expect, it } from 'vitest';
import { DRAFTS_KEY, DRAFTS_MAX, CommitDrafts } from '../src/lib/staging/commitDrafts.ts';
import { defaultChoice, filterBranches } from '../src/lib/shell/branchPicker.ts';
import type { KeyValueStorage } from '../src/lib/stores/prefs.svelte.ts';
import { local, remote } from './helpers/models.ts';

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('bản nháp commit', () => {
  it('lưu theo repo, đọc lại sau khi mở lại, xoá khi trống', () => {
    const storage = memoryStorage();
    const drafts = new CommitDrafts(storage);
    drafts.save('/repo/a', { summary: 'Sửa lỗi', body: 'Chi tiết' });
    drafts.save('/repo/b', { summary: 'Khác', body: '' });
    // Chưa ghi xuống kho nhưng đọc lại vẫn thấy bản đang chờ.
    expect(drafts.load('/repo/a')).toEqual({ summary: 'Sửa lỗi', body: 'Chi tiết' });
    drafts.flush();

    const reopened = new CommitDrafts(storage);
    expect(reopened.load('/repo/a')).toEqual({ summary: 'Sửa lỗi', body: 'Chi tiết' });
    expect(reopened.load('/repo/b')).toEqual({ summary: 'Khác', body: '' });
    expect(reopened.load('/repo/c')).toEqual({ summary: '', body: '' });

    reopened.save('/repo/a', { summary: '  ', body: '' });
    reopened.flush();
    expect(new CommitDrafts(storage).load('/repo/a')).toEqual({ summary: '', body: '' });
    expect(Object.keys(JSON.parse(storage.data.get(DRAFTS_KEY)!) as object)).toEqual(['/repo/b']);
  });

  it('dữ liệu hỏng thì bỏ qua; vượt trần thì bỏ bản cũ nhất', () => {
    const broken = new CommitDrafts(memoryStorage({ [DRAFTS_KEY]: '{không phải json' }));
    expect(broken.load('/x')).toEqual({ summary: '', body: '' });
    const wrong = new CommitDrafts(
      memoryStorage({ [DRAFTS_KEY]: JSON.stringify({ '/x': { summary: 1 }, '/y': 'z' }) }),
    );
    expect(wrong.load('/x')).toEqual({ summary: '', body: '' });

    const old = Object.fromEntries(
      Array.from({ length: DRAFTS_MAX }, (_, index) => [
        `/r${index}`,
        { summary: 's', body: '', at: index + 1 },
      ]),
    );
    const storage = memoryStorage({ [DRAFTS_KEY]: JSON.stringify(old) });
    const drafts = new CommitDrafts(storage);
    drafts.save('/moi', { summary: 'mới', body: '' });
    drafts.flush();
    const kept = Object.keys(JSON.parse(storage.data.get(DRAFTS_KEY)!) as object);
    expect(kept).toHaveLength(DRAFTS_MAX);
    expect(kept).toContain('/moi');
    expect(kept).not.toContain('/r0');
  });

  it('không có kho (localStorage bị chặn) thì vẫn chạy, chỉ không lưu', () => {
    const drafts = new CommitDrafts(null);
    drafts.save('/a', { summary: 'x', body: '' });
    drafts.flush();
    expect(drafts.load('/a')).toEqual({ summary: '', body: '' });
  });
});

describe('hộp chuyển nhánh', () => {
  const main = local('main', 'a', { isHead: true });
  const feature = local('feature/thanh-toan', 'b');
  const fix = local('fix/đăng-nhập', 'c');
  const remoteMain = remote('origin/main', 'a');
  const remoteNew = remote('origin/mới-tinh', 'd');
  const options = {
    recent: [main, feature, fix],
    local: [feature, fix, main],
    remote: [remoteMain, remoteNew],
    remotes: ['origin'],
  };

  it('chưa gõ gì là nhánh gần đây, mặc định chọn nhánh khác nhánh hiện tại', () => {
    const items = filterBranches('', options);
    expect(items).toEqual([main, feature, fix]);
    expect(defaultChoice(items)).toBe(1);
    expect(defaultChoice([main])).toBe(0);
    expect(defaultChoice([])).toBe(-1);
  });

  it('tìm không dấu, nhiều từ; local trước remote, khớp đầu tên trước', () => {
    expect(filterBranches('dang nhap', options)).toEqual([fix]);
    expect(filterBranches('MOI', options)).toEqual([remoteNew]);
    expect(filterBranches('main', options)).toEqual([main, remoteMain]);
    expect(filterBranches('t', options)[0]).toBe(feature);
    expect(filterBranches('khong-co', options)).toEqual([]);
  });
});
