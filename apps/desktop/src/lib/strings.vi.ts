/**
 * Mọi chuỗi giao diện (tiếng Việt) gom một chỗ để sau này tách ngôn ngữ nếu cần. File này chỉ GỘP các file con trong `strings/`:
 *  - `shell.vi.ts`: chuỗi "khung" (welcome, trust, window, graph, sidebar, inspector, time, errors, toast, dialog, menu, busy…)
 *    được trải phẳng nên `vi.window.x`, `vi.graph.x`… giữ nguyên như trước khi tách.
 *  - mỗi gói tính năng một namespace riêng: `vi.staging`, `vi.branches`, `vi.remote`, `vi.update` (một file, một gói) — nhờ vậy
 *    các gói làm song song không bao giờ trùng khoá hay sửa chung file. Test `strings.test.ts` giữ namespace không trùng khoá của shell.
 */
import { ai } from './strings/ai.vi.ts';
import { branches } from './strings/branches.vi.ts';
import { dnd } from './strings/dnd.vi.ts';
import { remote } from './strings/remote.vi.ts';
import { settings } from './strings/settings.vi.ts';
import { shell } from './strings/shell.vi.ts';
import { staging } from './strings/staging.vi.ts';
import { update } from './strings/update.vi.ts';

export const vi = {
  ...shell,
  staging,
  branches,
  remote,
  update,
  ai,
  settings,
  dnd,
} as const;
