/**
 * Mọi chuỗi giao diện gom một chỗ. `vi` là bộ chuỗi CỦA NGÔN NGỮ ĐANG DÙNG (giữ tên cũ để không phải sửa mọi nơi gọi):
 * tiếng Việt mặc định, tiếng Anh (`strings.en.ts`) khi người dùng chọn trong Cài đặt — chọn một lần lúc nạp app.
 * File này GỘP các file con trong `strings/` (mỗi `*.vi.ts` có bản `*.en.ts` cùng khoá):
 *  - `shell.vi.ts`: chuỗi "khung" (welcome, trust, window, graph, sidebar, inspector, time, errors, toast, dialog, menu, busy…)
 *    được trải phẳng nên `vi.window.x`, `vi.graph.x`… giữ nguyên như trước khi tách.
 *  - mỗi gói tính năng một namespace riêng: `vi.staging`, `vi.branches`, `vi.remote`, `vi.update`, `vi.snapshots`, `vi.history` (một file, một gói) — nhờ vậy
 *    các gói làm song song không bao giờ trùng khoá hay sửa chung file. Test `strings.test.ts` giữ namespace không trùng khoá của shell.
 */
import { locale } from './i18n/locale.ts';
import { en } from './strings.en.ts';
import { accounts, pullRequests } from './strings/accounts.vi.ts';
import { ai } from './strings/ai.vi.ts';
import { branches } from './strings/branches.vi.ts';
import { dnd } from './strings/dnd.vi.ts';
import { history } from './strings/history.vi.ts';
import { rebase } from './strings/rebase.vi.ts';
import { remote } from './strings/remote.vi.ts';
import { risk } from './strings/risk.vi.ts';
import { settings } from './strings/settings.vi.ts';
import { shell } from './strings/shell.vi.ts';
import { snapshots } from './strings/snapshots.vi.ts';
import { staging } from './strings/staging.vi.ts';
import type { Translation } from './strings/types.ts';
import { update } from './strings/update.vi.ts';

const viStrings = {
  ...shell,
  staging,
  branches,
  remote,
  update,
  ai,
  settings,
  dnd,
  history,
  rebase,
  accounts,
  pullRequests,
  snapshots,
  risk,
} as const;

/** Hình dạng chung của mọi bản dịch (chữ là `string`, hàm giữ nguyên tham số). */
export type Strings = Translation<typeof viStrings>;

export const vi: Strings = locale === 'en' ? en : viStrings;
