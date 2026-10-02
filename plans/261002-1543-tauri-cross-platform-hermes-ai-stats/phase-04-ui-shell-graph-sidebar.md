---
phase: 4
title: "UI Shell Graph & Sidebar"
status: pending
priority: P1
effort: "9-11 ngày (4a: 5-6, 4b: 4-5)"
dependencies: [3]
---

# Phase 4: UI Shell, Graph & Sidebar

## Overview
Khung app + phần "nhìn", chia 2 lát, mỗi lát kết thúc bằng bản chạy được:
- **4a (M1a):** RepoStore, graph ảo hoá, sidebar, chi tiết commit/stash, giao diện kính, harness E2E.
- **4b (M1b):** toolbar, chuyển nhánh ⌘/Ctrl+B, Welcome/clone/tạo repo, hỏi tin tưởng repo lạ, menu + phím tắt, cài đặt.

## Context Links
- Spec Swift: `Views/RepoWindowView.swift`, `Views/Graph/*`, `Views/SidebarView.swift`, `Views/Inspector/CommitDetailView.swift`, `Views/WelcomeView.swift`, `Views/CloneSheet.swift`, `Views/SettingsView.swift`, `Views/Theme.swift`, `App/AppCommands.swift`, `Model/RepoModel.swift`
- [Bài học hiệu năng](./reports/scout-report.md#lessons-from-swift-build-apply-to-tauri-port) · [Red team](./plan.md#red-team-review): SC2, SC5, SC6, SC9, FM5, FM9, SA1, SA2

## Key Insights
- Graph: danh sách ảo hoá DOM (hàng 30 px) cho cột chữ + **một canvas** phủ cột Graph chỉ vẽ phần thấy (theo `devicePixelRatio`) → chữ sắc, chọn/copy được, 60 fps.
- Sidebar: chỉ dựng node đang mở; thư mục > 30 nhánh thu gọn; "Hiện thêm" mỗi lần 200; component sidebar không phụ thuộc `status`/`selection`.
- **Mỗi repo một cửa sổ** (như Swift `WindowGroup(for:)`): mở repo đã mở → focus cửa sổ đó (so `repoId`). Không TabBar, không tự khôi phục ở MVP (Welcome có danh sách gần đây). Tab trong app: 1.x.
- **Ngôn ngữ kính** như app Swift: Rust chọn `windowEffects` theo OS khi tạo cửa sổ — macOS 26+ `LiquidGlassRegular`; macOS 14–15 `Sidebar`/`UnderWindowBackground`; Windows 11 `Mica`; Windows 10 nền đặc (`Acrylic` giật khi kéo/resize). Cửa sổ `transparent: true` (+ `macOSPrivateApi`). CSS `backdrop-filter` chỉ cho chrome (toolbar, sidebar, popover, toast), không phủ vùng graph/diff để giữ 60 fps.
- **Fallback**: OS tắt trong suốt (macOS "Giảm độ trong suốt", Windows "Transparency effects" tắt) hoặc user tắt trong Cài đặt → class `no-glass`: nền đặc, cùng token màu, đủ tương phản. Rust đọc thiết lập OS và phát sự kiện khi đổi.
- Menu Tauri v2 (native macOS; menu cửa sổ trên Windows) + context menu native `Menu.popup()`.

## Requirements
**4a**
- RepoStore (port `RepoModel`): nạp song song, fingerprint ref → nạp lại lịch sử; nhận `repo-changed` (đã debounce ở Rust — không debounce thêm); mọi thao tác ghi qua hàng đợi (Rust khoá theo commonDir); auto-fetch là op `network` ưu tiên thấp, bỏ qua khi có pull/push/fetch đang chờ; toast có nút hành động.
- Graph: cột Nhánh/Tag (pill local/remote/tag, HEAD), Graph (làn màu, đường cong, node chữ cái đầu, WIP nét đứt), Commit, Tác giả, Thời gian (tương đối/tuyệt đối), SHA; kéo đổi rộng cột; tự co/ẩn cột khi hẹp (luật Swift); tải thêm khi cuộn; tìm có tô sáng, ↑↓/Enter; context menu commit.
- Sidebar: LOCAL/REMOTE/TAGS/STASHES, cây theo `/`, ahead/behind, upstream gone, lọc, đếm, context menu, nhấp đúp để checkout/apply stash.
- Inspector: chi tiết commit (summary, body rút gọn + "Xem toàn bộ", tác giả/committer, SHA copy, cha click được, danh sách file), chi tiết stash, chỗ cho panel WIP (phase 5).
- Theme: token sáng/tối; màu thương hiệu xanh `#2F86E8`, cam git `#F05032`; 12 màu làn từ `GraphStyle.swift` (2 màu đầu là màu thương hiệu); kính + fallback như trên.
- Harness E2E: WebdriverIO + `@wdio/tauri-service` (WebDriver nhúng trong app, chạy được cả macOS) + script tạo repo tạm; kịch bản đầu: mở repo, cuộn graph, chọn commit; CI 2 OS mỗi PR. Dùng luôn cho test IPC 50 MB (phase 2).

**4b**
- Toolbar: đổi nhánh nhanh (15 nhánh gần đây + "Tìm & chuyển nhánh…" ⌘/Ctrl+B), Fetch, Pull (chọn kiểu), Push (↑n), Branch, Stash, Pop, Mở Terminal/Editor (app đầu tiên tìm thấy), ẩn/hiện inspector, ô tìm kiếm.
- Welcome: gần đây (xoá khỏi danh sách), mở thư mục (dialog từ Rust), clone (URL dán từ clipboard → hiện host đã parse; từ chối `ext::`, `fd::`, URL bắt đầu bằng `-`; cảnh báo URL có token sẽ nằm trong `.git/config`; chọn thư mục; tiến trình; huỷ), tạo repo (`--initial-branch=main` nếu chưa cấu hình). Mở qua argv/thả lên icon app (single-instance chuyển tiếp).
- Hỏi tin tưởng: repo có khoá chạy lệnh/hook lạ → hộp thoại liệt kê khoá + nguồn (`--show-origin`): "Tin tưởng repo" / "Mở ở chế độ hạn chế"; chế độ hạn chế có nhãn trên toolbar.
- Cài đặt (như Swift): số commit tải, thứ tự, hiện remote/tag, thời gian tương đối, giao diện (sáng/tối/theo hệ thống, tắt kính), đường dẫn git (Rust là nguồn sự thật), kiểu pull, prune, chu kỳ tự fetch, diff (ngữ cảnh, tách đôi), kênh cập nhật (phase 8a).
- Menu + phím tắt (bảng trong README; ⌘ trên macOS ↔ Ctrl trên Windows; ⌘/Ctrl+T mở cửa sổ Welcome mới thay cho "Tab mới").
- Tài khoản GitHub (như bản Swift, người dùng yêu cầu 2026-10-02): OAuth Device Flow (client ID của OAuth App dùng chung với bản Swift, scope `repo workflow`); Rust gọi API GitHub và giữ token trong kho bí mật của OS (macOS Keychain / Windows Credential Manager); token chỉ cấp cho lệnh mạng tới `https://github.com` qua `-c credential.https://github.com.helper=` (xoá helper của người dùng cho github.com) + helper đọc biến môi trường của tiến trình; Clone có danh sách "Repo GitHub của bạn"; lỗi xác thực → gợi ý đăng nhập lại.

**Non-functional:** repo 30k commit / 1.077 ref: graph hiện < 1,5 s; cuộn 60 fps; chọn commit < 50 ms; RAM rảnh < 300 MB; sự kiện file → **bắt đầu** làm mới < 400 ms (thời gian `status` đo riêng).

## Architecture
```
apps/desktop/src/
├── lib/stores/     app.svelte.ts (recent do Rust lưu, settings) · repo.svelte.ts (RepoStore) · toasts.svelte.ts
├── lib/graph/      GraphView.svelte · GraphCanvas.ts · columns.ts · pills.ts
├── lib/sidebar/    Sidebar.svelte · BranchTree.svelte · LimitedRows.svelte
├── lib/inspector/  CommitDetail.svelte · StashDetail.svelte
├── lib/shell/      Toolbar · BranchSwitcher · SwitchBranchDialog · Welcome · CloneDialog · TrustDialog · Settings · menus.ts · shortcuts.ts
├── lib/theme/      tokens.css (sáng/tối/no-glass) · glass.css
├── lib/strings.vi.ts
└── workers/        history.worker.ts
tests/e2e/          wdio.conf.ts · fixtures (tạo repo tạm) · specs/
```
Luồng: RepoStore → `repo.execLog()` (main thread, frame IPC) → bytes chuyển sang worker → parse + layout → `GraphEntry[]` → GraphView (ảo hoá) + GraphCanvas (vẽ phần thấy).

## Related Code Files
- Create: các file trên; `apps/desktop/src-tauri/src/window_effects.rs` (chọn hiệu ứng theo OS + đọc thiết lập trong suốt)
- Modify: `tauri.conf.json` (window `transparent`, `macOSPrivateApi`, menu), `capabilities/default.json` (dialog, clipboard, store, window-state, single-instance; opener chỉ URL)

## Implementation Steps
**4a**
1. Shell (Welcome ↔ cửa sổ repo, dedupe theo `repoId`) + theme kính/fallback + `strings.vi.ts`.
2. RepoStore: port pipeline làm mới từ `RepoModel.swift` + nối watcher + hàng đợi (Rust khoá).
3. GraphView ảo hoá (tự viết ≈ 150 dòng hoặc `@tanstack/svelte-virtual`) + GraphCanvas (port `GraphCells.swift`: đường cong `toNode`/`fromNode`, màu theo làn, WIP nét đứt, node chữ cái đầu).
4. Cột: kéo đổi rộng; port `fitColumns` (co Tác giả → Thời gian → Nhánh tới mức tối thiểu, rồi ẩn SHA → Thời gian → Tác giả); lưu độ rộng.
5. Sidebar lazy (LimitedRows/BranchTree), lọc, context menu native.
6. Inspector commit/stash; avatar chữ cái đầu (Gravatar: 1.x, cần đồng ý vì lộ hash email).
7. Harness WebdriverIO + kịch bản đầu + test IPC 50 MB.
8. Bench repo 30k → `reports/perf-phase4.md`.

**4b**
9. Toolbar + BranchSwitcher + SwitchBranchDialog (mặc định chọn nhánh gần nhất khác HEAD).
10. Welcome + Clone + Init + TrustDialog.
11. Menus + phím tắt.
12. Settings.

## Todo List
- [ ] (4a) Shell + cửa sổ theo repo + theme kính/fallback
- [ ] (4a) RepoStore + watcher + hàng đợi
- [ ] (4a) GraphView + canvas + cột
- [ ] (4a) Sidebar
- [ ] (4a) Inspector
- [ ] (4a) Harness E2E WebdriverIO (CI 2 OS)
- [ ] (4a) Bench 30k đạt ngưỡng
- [ ] (4b) Toolbar + chuyển nhánh
- [ ] (4b) Welcome/clone/init + hỏi tin tưởng
- [ ] (4b) Menus + phím tắt + cài đặt

## Success Criteria
- [ ] (4a) Repo demo + repo 30k mở trên 2 OS; graph đúng theo checklist (`docs/qa-checklist.md`, mục Graph: merge nhiều cha, nhánh dài, WIP, tag, HEAD tách rời)
- [ ] (4a) Kính đúng trên macOS 26 / macOS 14–15 / Windows 11; tắt trong suốt → nền đặc, chữ đủ tương phản
- [ ] (4a) E2E harness xanh trên CI 2 OS
- [ ] Đạt ngưỡng hiệu năng (ghi `reports/perf-phase4.md`)
- [ ] Sửa file / commit từ terminal → UI tự làm mới; `npm install` không gây làm mới liên tục
- [ ] (4b) Repo có hook/khoá chạy lệnh → hỏi tin tưởng trước khi bất kỳ hook/filter nào chạy
- [ ] (4b) Mở lại repo đang mở → focus đúng cửa sổ; 2 linked worktree cùng commonDir dùng chung khoá

## Risk Assessment
- WKWebView vs WebView2 (font, scroll, canvas) → CI Windows xanh mỗi PR + chạy tay trên Windows thật mỗi mốc.
- Canvas mờ ở DPI 125/150% → scale theo `devicePixelRatio`, vẽ lại khi đổi DPI.
- Trong suốt/`backdrop-filter` tốn GPU → chỉ cho chrome; đo fps; tắt được trong Cài đặt.
- Rollback: chưa phát hành tới M1b → revert commit.

## Security Considerations
- Chuỗi từ repo (message, tác giả, tên nhánh/file) chỉ render dạng text; cấm `{@html}` bằng lint rule.
- CSP chặt + `on_navigation` (phase 2 bước 10); link trong commit hiện URL đầy đủ, mở qua `open_url` (chỉ `https:`).
- Không auto-fetch ở repo chế độ hạn chế.

## Next Steps
- Phase 5 thêm staging/diff/conflict lên khung này.
