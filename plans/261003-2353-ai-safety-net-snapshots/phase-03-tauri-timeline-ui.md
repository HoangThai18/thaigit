---
phase: 3
title: "Giao diện dòng thời gian Tauri"
status: completed
priority: P1
dependencies: [2]
---

# Phase 3: Giao diện dòng thời gian Tauri

## Overview
Bộ lập lịch chụp theo watcher, panel "Dòng thời gian", cài đặt bật/tắt theo repo + thời hạn giữ, thông báo lần đầu.

## Architecture
- `apps/desktop/src/lib/snapshots/scheduler.ts` (thuần, test được): nhận sự kiện `workingTree` → hẹn chụp sau `quietMs`; mỗi sự kiện mới đẩy lùi; không chụp khi chưa đủ `minIntervalMs` từ lần trước (hẹn lại), khi repo đang bận (`store.busy`), khi tắt cho repo. Sau mỗi lần chụp: `prune` (tối đa 1 lần / giờ).
- `snapshots/timeline.svelte.ts`: store danh sách mốc, chọn mốc, so sánh với "bây giờ" (chụp mốc hiện tại trước khi so — gồm cả file chưa track), khôi phục file / tất cả, Hoàn tác qua toast như các thao tác khác.
- `snapshots/TimelinePanel.svelte`: danh sách mốc (giờ tương đối, lý do, số file), bấm → danh sách file khác (dùng lại `inspector/FileList.svelte`) → diff (dùng lại `DiffPane`); nút "Khôi phục file này" / "Khôi phục tất cả về mốc này" (hỏi xác nhận).
- Mở panel: menu Thêm + bảng lệnh + nút trên `WipPanel`.
- Cài đặt (`settings.svelte.ts`, `SettingsPanel.svelte`): bật mặc định, thời hạn giữ (ngày, số mốc); theo repo: `prefs.svelte.ts` (`snapshotsDisabled`).
- Lần đầu chụp trên máy: toast giải thích + nút "Tắt cho repo này".
- Chuỗi: `strings/snapshots.vi.ts` gộp vào `strings.vi.ts`. Lỗi qua `errors/friendly.ts`.
- Lệnh nền không ghi rác vào Nhật ký lệnh: kiểm cách auto-fetch đang làm, làm giống.

## Related Code Files
- Create: `apps/desktop/src/lib/snapshots/{scheduler.ts,timeline.svelte.ts,TimelinePanel.svelte}`, `apps/desktop/src/lib/strings/snapshots.vi.ts`, `apps/desktop/test/snapshot-scheduler.test.ts`, `apps/desktop/test/snapshot-timeline.test.ts`
- Modify: `stores/repo.svelte.ts` (nối sự kiện watcher), `shell/RepoWindow.svelte`, `inspector/WipPanel.svelte`, `stores/settings.svelte.ts`, `stores/prefs.svelte.ts`, `settings/SettingsPanel.svelte`, `stores/menus.svelte.ts` / bảng lệnh, `strings.vi.ts`, `errors/friendly.ts`

## Implementation Steps (TDD)
**Tests Before**: scheduler bằng đồng hồ giả (debounce, khoảng tối thiểu, bỏ khi bận/tắt, prune ≤ 1 lần/giờ); timeline store với repo thật (khôi phục + Hoàn tác, so sánh gồm file chưa track).
**Implement** UI. **Kiểm trong trình duyệt** bằng cầu nối DEV (chỉ-đọc → panel hiện danh sách; thao tác ghi kiểm bằng app thật / test).
**Regression gate**: `pnpm check && pnpm lint && pnpm --filter @thaigit/desktop test` (gồm `no-raw-html.test.ts`).

## Success Criteria
- [ ] Sửa file → ≤ 2 phút có mốc mới; tắt cho repo → không chụp.
- [ ] Khôi phục có hỏi xác nhận, có Hoàn tác, không hiện lỗi thô.
- [ ] `{#each}` key theo index (sha có thể trùng khi dedupe).
