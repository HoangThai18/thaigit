// Progress label of an in-flight operation, taken from the string table in the active language — the core
// never hardcodes Vietnamese, so the English UI can't leak "Đang merge" (a port of Swift's
// `String(localized:)`).
import { describe, expect, it } from 'vitest';
import { operationTitle } from '../src/lib/operationLabel.ts';
import { en } from '../src/lib/strings.en.ts';
import { vi } from '../src/lib/strings.vi.ts';

const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

describe('nhãn thao tác dở dang', () => {
  it('lấy đúng nhãn của từng loại thao tác', () => {
    expect(operationTitle({ kind: 'merging' })).toBe(vi.branches.running.merging);
    expect(operationTitle({ kind: 'cherryPicking' })).toBe(vi.branches.running.cherryPicking);
    expect(operationTitle({ kind: 'applyingPatches' })).toBe(vi.branches.running.applyingPatches);
  });

  it('rebase có bước thì ghép "(x/y)", không có thì dùng nhãn chung', () => {
    const stepped = { kind: 'rebasing', step: 2, total: 5, headName: null } as const;
    expect(operationTitle(stepped)).toBe('Đang rebase (2/5)');
    expect(operationTitle({ ...stepped, step: null, total: null })).toBe('Đang rebase');
  });

  it('bản tiếng Anh là thuật ngữ git, không còn chữ tiếng Việt', () => {
    expect(en.branches.running.merging).toBe('Merging');
    expect(en.branches.runningRebaseStep(2, 5)).toBe('Rebasing (2/5)');
    for (const label of Object.values(en.branches.running)) expect(label).not.toMatch(VIETNAMESE);
  });
});
