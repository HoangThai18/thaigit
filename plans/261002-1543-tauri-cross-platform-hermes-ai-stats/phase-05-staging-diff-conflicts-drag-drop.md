---
phase: 5
title: "Staging Diff Conflicts & Drag-Drop"
status: pending
priority: P1
effort: "10-14 ngày"
dependencies: [4]
---

# Phase 5: Staging, Diff, Conflicts & Drag-Drop

## Overview
Phần "làm việc" của Thaigit: panel stage/commit, trình xem diff có stage từng dòng/hunk, diff ảnh, trình giải quyết xung đột, banner merge/rebase, kéo-thả kiểu GitKraken, toast hoàn tác, và các hộp thoại (nhánh, tag, push, stash, remote, danh tính, nhật ký lệnh, lịch sử file).

## Context Links
- Spec Swift: `Views/Inspector/StagingView.swift`, `Views/Diff/DiffPane.swift`, `Views/Diff/ConflictResolverView.swift`, `Views/Sheets/Sheets.swift`, `Model/RepoModel+Diff.swift`, `Model/RepoModel+Actions.swift` (`dropOptions`, menus, undo)

## Key Insights
- **Diff viewer tự viết** trên hunk đã parse từ git (không dùng CodeMirror merge view: nó tự tính diff nên lệch với hunk git, dẫn tới patch stage sai). Syntax highlight làm sau, chỉ tô các dòng đang thấy.
- Kéo-thả: Tauri bật `dragDropEnabled` (để thả thư mục từ Finder/Explorer vào mở repo) thì trên Windows HTML5 DnD trong webview **không chạy**. Vì vậy kéo-thả trong app dùng **pointer events** tự viết (kéo nhánh/file, ảnh kéo, vùng thả sáng lên), không dùng HTML5 DnD → hành vi giống nhau trên 2 OS.
- Mọi thao tác phá dữ liệu đều có hoàn tác (port nguyên cơ chế: soft reset, `reset --merge`, `update-ref`, `stash store`, `stash create` + `restore --source`, khôi phục từ Thùng rác).

## Requirements
- Functional
  - Staging: 2 danh sách (chưa stage/đã stage) ảo hoá, chọn nhiều, nút nhanh khi hover, nhấp đúp/Space để stage-unstage, kéo file giữa 2 danh sách, huỷ thay đổi (xác nhận + hoàn tác), thêm vào .gitignore, xung đột đứng đầu.
  - Commit composer: tóm tắt/mô tả, amend (điền sẵn message cũ), ⌘/Ctrl+Enter, "Stage tất cả & commit", lỗi chưa có danh tính → hộp thoại danh tính, toast "Hoàn tác" commit. Chỗ trống cho nút AI (phase 6).
  - Diff: gộp/tách đôi, tô sáng đoạn chữ thay đổi trong dòng, nút Stage/Huỷ/Bỏ stage cho từng hunk, chọn dòng (click, Shift+click) + thanh "Đã chọn n dòng", file lớn thì cảnh báo "Hiển thị vẫn được", file nhị phân, diff ảnh (trước/sau, kích thước pixel, không phóng quá cỡ thật), Esc quay lại graph.
  - Conflict: danh sách file xung đột, trình giải quyết theo từng khối (giữ Current/Incoming/Cả hai/Base), xem trước kết quả, "Lưu & đánh dấu đã giải quyết", mở bằng editor, trường hợp không có marker (bên kia xoá…), banner Tiếp tục/Bỏ qua/Huỷ cho merge, rebase, cherry-pick, revert.
  - Kéo-thả: pill/nhánh sidebar → nhánh khác (merge, rebase, fast-forward); nhánh → remote/nhánh remote (push); tag → remote (push tag); hộp thoại "Thả X lên Y" liệt kê lựa chọn hợp lệ (port `dropOptions`).
  - Hộp thoại: tạo/đổi tên nhánh, tạo tag, push (remote, nhánh đích, upstream, force-with-lease), stash kèm lời nhắn, thêm remote, danh tính, nhật ký lệnh git, lịch sử file.
  - Lỗi có lối thoát: checkout bị chặn → "Stash rồi checkout"; push bị từ chối → "Pull" / "Force push…"; pull lệch nhánh → chọn merge/rebase.
- Non-functional: diff 5.000 dòng cuộn mượt; stage 1 dòng dưới 300 ms (gồm làm mới).

## Architecture
```
apps/desktop/src/lib/
├── staging/   StagingPanel · FileList (virtual) · CommitComposer · IdentityDialog
├── diff/      DiffPane · DiffHeader · UnifiedView (virtual) · SplitView (virtual) · HunkHeader · LineSelectionBar · ImageDiff
├── conflict/  ConflictList · ConflictResolver · OperationBanner
├── dnd/       pointerDrag.ts (drag session, ghost, hit-test vùng thả) · dropOptions.ts (port từ Swift)
├── dialogs/   CreateBranch · RenameBranch · CreateTag · Push · Stash · AddRemote · CommandLog · FileHistory · ConfirmDialog
└── stores/    diff.svelte.ts (openFile, lineSelection, apply hunk/lines → core.patchBuilder)
```

## Related Code Files
- Create: các file trên
- Modify: `lib/stores/repo.svelte.ts` (thao tác + undo), `lib/graph/GraphView.svelte` (pill là nguồn kéo/đích thả), `lib/sidebar/*` (nguồn/đích thả)

## Implementation Steps
1. Staging panel + composer + undo commit.
2. Diff store + UnifiedView/SplitView ảo hoá (port `DiffPresentation`: tab → 4 dấu cách, cắt dòng 1.200 ký tự, splitRows).
3. Stage/huỷ hunk và dòng qua `patchBuilder` (core) + `git apply --cached --recount` + toast hoàn tác cho huỷ.
4. ImageDiff (blob từ `git cat-file`/working file qua Rust → object URL).
5. Conflict: list + resolver + banner + continue/abort/skip (port `ConflictFile` đã có ở core).
6. `pointerDrag.ts`: ngưỡng bắt đầu kéo 4 px, ảnh kéo là pill, auto-scroll khi tới mép, Esc để huỷ; đích thả đăng ký vùng + validate; sau khi thả mở dialog lựa chọn.
7. Các hộp thoại + luồng lỗi có lối thoát.
8. Kịch bản kiểm thử UI (Playwright + mock IPC, xem phase 9): stage 2 dòng, commit + hoàn tác, stash/pop, kéo merge, giải conflict theirs → continue.

## Todo List
- [ ] Staging + composer + undo
- [ ] Diff gộp/tách + highlight + chọn dòng
- [ ] Stage/huỷ hunk & dòng
- [ ] Image diff
- [ ] Conflict resolver + banner
- [ ] Pointer DnD + drop options
- [ ] Hộp thoại + luồng lỗi
- [ ] Kịch bản UI tests

## Success Criteria
- [ ] Toàn bộ kịch bản hồi quy của bản Swift chạy đúng trên cả 2 OS (stage dòng, commit/hoàn tác, stash, kéo-thả merge, conflict → merge commit, push/pull với remote cục bộ)
- [ ] Stage dòng đúng cả với file CRLF trên Windows
- [ ] Kéo-thả hoạt động như nhau trên macOS và Windows

## Risk Assessment
- Pointer DnD tự viết dễ sót case (cuộn khi kéo, đa màn hình). Giảm thiểu: phạm vi nhỏ (chỉ trong cửa sổ), test thủ công theo checklist.
- Diff rất lớn (lockfile 50k dòng) → mặc định thu gọn + nút "Hiện vẫn được"; giới hạn chọn dòng trong hunk đang thấy.

## Security Considerations
- Nội dung file/diff hiển thị dạng text (escape), ảnh qua object URL nội bộ, không nạp URL ngoài.
- "Mở bằng editor" truyền path dạng tham số, không qua shell.

## Next Steps
- Phase 6 gắn nút AI vào CommitComposer, CommitDetail, menu nhánh.
