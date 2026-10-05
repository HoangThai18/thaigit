// Nhãn tiến trình của thao tác dở dang (merge / rebase / cherry-pick / revert / git am / bisect) theo ngôn ngữ đang
// dùng. Lõi `@thaigit/core` chỉ trả về loại thao tác và tên ngắn kiểu git (`operationShortName`); chữ "Đang merge"
// / "Merging" do app bản dịch, giống bản Swift dùng `String(localized:)`.

import type { RepoOperation } from '@thaigit/core';

import { vi } from './strings.vi.ts';

/** Banner thao tác dở dang + dòng phụ dưới tên repo + thông báo lỗi của thao tác đó. */
export function operationTitle(operation: RepoOperation): string {
  if (operation.kind === 'rebasing' && operation.step !== null && operation.total !== null) {
    return vi.branches.runningRebaseStep(operation.step, operation.total);
  }
  return vi.branches.running[operation.kind];
}
