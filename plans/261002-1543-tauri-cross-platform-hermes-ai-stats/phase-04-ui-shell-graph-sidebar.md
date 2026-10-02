---
phase: 4
title: "UI Shell Graph & Sidebar"
status: pending
priority: P1
effort: "8-10 ngày"
dependencies: [3]
---

# Phase 4: UI Shell, Graph & Sidebar

## Overview
Dựng khung app và phần "nhìn" của Thaigit: màn hình chào (mở / clone / tạo repo), tab nhiều repo, thanh công cụ, graph commit ảo hoá (canvas), sidebar nhánh/tag/stash, panel chi tiết commit, tìm kiếm, cài đặt, phím tắt, giao diện sáng/tối. Đạt tương đương bản Swift ở các phần này.

## Context Links
- Spec từ Swift: `Views/RepoWindowView.swift`, `Views/Graph/*`, `Views/SidebarView.swift`, `Views/Inspector/CommitDetailView.swift`, `Views/WelcomeView.swift`, `Views/CloneSheet.swift`, `Views/SettingsView.swift`, `App/AppCommands.swift`, `Model/RepoModel.swift`
- [Bài học hiệu năng](./reports/scout-report.md#lessons-from-swift-build-apply-to-tauri-port)

## Key Insights
- Graph: **danh sách ảo hoá DOM** (hàng cố định 30 px) cho các cột chữ + **một canvas phủ cột Graph** chỉ vẽ các hàng đang thấy (theo `devicePixelRatio`). Chữ vẫn sắc nét, chọn/copy được, mà vẫn đạt 60 fps.
- Sidebar: chỉ dựng node đang mở; thư mục trên 30 nhánh mặc định thu gọn; "Hiện thêm" mỗi lần 200 (đúng như bản Swift sau khi tối ưu).
- Component sidebar **không** phụ thuộc `status`/`selection` để tránh render lại cả cây khi lưu file hay chọn commit (bài học Swift).
- Tab trong app (một cửa sổ, nhiều repo) chạy giống nhau trên 2 OS. Tab native của macOS không có trên Windows.
- Menu: dùng Menu API của Tauri v2 (menu native trên macOS; trên Windows cũng là menu native của cửa sổ) và context menu native qua `Menu.popup()`.

## Requirements
- Functional
  - Welcome: gần đây (xoá khỏi danh sách), mở thư mục, clone (URL dán sẵn từ clipboard, chọn thư mục, tiến trình, huỷ), tạo repo; thả thư mục vào cửa sổ để mở.
  - Tabs: ⌘/Ctrl+T, ⌘/Ctrl+W, khôi phục tab khi mở lại app.
  - Toolbar: đổi nhánh nhanh (15 nhánh gần đây + "Tìm & chuyển nhánh…" ⌘/Ctrl+B), Fetch, Pull (menu chọn kiểu), Push (↑n), Branch, Stash, Pop, Mở Terminal/Editor, ẩn/hiện inspector, ô tìm kiếm.
  - Graph: cột Nhánh/Tag (pill local/remote/tag, HEAD), Graph (làn màu, đường cong, node avatar chữ cái đầu, WIP nét đứt), Commit, Tác giả, Thời gian (tương đối/tuyệt đối), SHA. Kéo đổi rộng/thứ tự cột; tự co/ẩn cột khi hẹp (luật như Swift); tải thêm khi cuộn; tìm kiếm có tô sáng và ↑↓ để nhảy; phím ↑↓/Enter; context menu commit.
  - Sidebar: LOCAL/REMOTE/TAGS/STASHES, cây thư mục theo `/`, ahead/behind, upstream gone, lọc, đếm, context menu, nhấp đúp để checkout/apply stash.
  - Inspector: chi tiết commit (summary, body rút gọn + "Xem toàn bộ", tác giả/committer, SHA copy, cha click được, danh sách file), chi tiết stash, panel WIP (phase 5).
  - Cài đặt: chung (số commit tải, thứ tự, hiện remote/tag, thời gian tương đối, ngôn ngữ vi/en, giao diện), git (đường dẫn git, kiểu pull, prune, tự fetch), diff (ngữ cảnh, tách đôi).
  - RepoStore (port RepoModel): nạp song song, fingerprint ref → nạp lại lịch sử, debounce sự kiện file 300 ms, hoãn khi đang chạy thao tác, hàng đợi thao tác tuần tự, toast có nút hành động.
- Non-functional: repo 30k commit / 1.100 ref: hiện graph dưới 1,5 s; cuộn 60 fps; chọn commit dưới 50 ms; app rảnh dưới 300 MB RAM.

## Architecture
```
apps/desktop/src/
├── lib/stores/      app.svelte.ts (tabs, recent, settings) · repo.svelte.ts (RepoStore) · toasts.svelte.ts
├── lib/graph/       GraphView.svelte · GraphCanvas.ts (vẽ làn) · columns.ts (fit/hide) · pills.ts
├── lib/sidebar/     Sidebar.svelte · BranchTree.svelte · LimitedRows.svelte
├── lib/inspector/   CommitDetail.svelte · StashDetail.svelte
├── lib/shell/       TabBar · Toolbar · BranchSwitcher · SwitchBranchDialog · Welcome · CloneDialog · Settings · menus.ts · shortcuts.ts
└── workers/         history.worker.ts (parse log + layout bằng @thaigit/core)
```
Luồng: RepoStore → `repository.history()` qua Exec Tauri → bytes → worker parse + layout → `GraphEntry[]` → GraphView (virtual) + GraphCanvas (vẽ phần thấy).

## Related Code Files
- Create: các file trên + `apps/desktop/src/lib/i18n/{vi,en}.json`, `apps/desktop/src/lib/theme.css` (token màu sáng/tối, bảng 12 màu làn từ `GraphStyle.swift`)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (menu, window), `capabilities/*.json` (dialog, opener, clipboard, store, window-state, single-instance)

## Implementation Steps
1. Shell + router đơn giản (welcome ↔ repo tab), theme sáng/tối theo OS, i18n.
2. RepoStore: port pipeline làm mới từ `RepoModel.swift` (nạp song song, fingerprint, hoãn khi bận, toasts) + nối watcher (phase 2).
3. GraphView: virtual list (tự viết, khoảng 150 dòng, hoặc `@tanstack/svelte-virtual`); GraphCanvas vẽ theo `GraphRow` (port thuật toán vẽ từ `GraphCells.swift`: đường cong `toNode`/`fromNode`, màu theo làn, WIP nét đứt, node có chữ cái đầu).
4. Cột: kéo đổi rộng/đổi chỗ; port `fitColumns` (co Tác giả → Thời gian → Nhánh tới mức tối thiểu, rồi ẩn SHA → Thời gian → Tác giả); lưu độ rộng người dùng chọn.
5. Sidebar với LimitedRows/BranchTree (lazy), lọc, context menu native.
6. Inspector chi tiết commit/stash; avatar chữ cái đầu (Gravatar để stretch, phải có đồng ý vì lộ email hash).
7. Toolbar + BranchSwitcher + SwitchBranchDialog (port sheet ⌘B: mặc định chọn nhánh gần nhất khác HEAD).
8. Welcome + Clone (tiến trình qua kênh stderr, huỷ) + tạo repo (`--initial-branch=main` nếu chưa cấu hình).
9. Menus + phím tắt (bảng trong README cũ; ⌘ trên macOS ↔ Ctrl trên Windows).
10. Bench thủ công trên repo giả 30k + ghi kết quả vào `reports/perf-phase4.md`.

## Todo List
- [ ] Shell, tabs, theme, i18n
- [ ] RepoStore + watcher
- [ ] GraphView + canvas + cột
- [ ] Sidebar
- [ ] Inspector
- [ ] Toolbar + switch branch
- [ ] Welcome/clone/init
- [ ] Menus + shortcuts
- [ ] Bench 30k đạt ngưỡng

## Success Criteria
- [ ] Mở repo demo và repo 30k commit trên cả 2 OS, graph đúng như bản Swift (so ảnh chụp)
- [ ] Đạt các ngưỡng hiệu năng ở trên (ghi trong `reports/perf-phase4.md`)
- [ ] Sửa file / commit từ terminal → UI tự cập nhật

## Risk Assessment
- Khác biệt WKWebView vs WebView2 (font, scroll, canvas). Giảm thiểu: test trực quan cả 2 OS mỗi PR; tránh API chỉ Chromium có.
- Canvas mờ trên màn hình DPI lẻ của Windows (125%/150%). Giảm thiểu: scale theo `devicePixelRatio`, vẽ lại khi DPI đổi.

## Security Considerations
- Không render HTML từ commit message (chỉ text, escape) → tránh XSS từ repo lạ.
- CSP chặt trong `tauri.conf.json` (không `unsafe-eval`, không tải script từ ngoài).

## Next Steps
- Phase 5 thêm staging/diff/conflict/drag-drop lên khung này.
