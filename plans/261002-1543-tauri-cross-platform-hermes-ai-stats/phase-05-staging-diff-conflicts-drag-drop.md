---
phase: 5
title: "Staging Diff Conflicts & Drag-Drop"
status: pending
priority: P1
effort: "12-16 ngày (5a, 5b, 5c, 5d: mỗi lát 3-4)"
dependencies: [4]
---

# Phase 5: Staging, Diff, Conflicts & Drag-Drop

## Overview
Phần "làm việc", chia 4 lát, mỗi lát ra bản chạy được:
- **5a (M1b):** stage/unstage/huỷ theo file, commit composer, amend, hoàn tác bền (nhật ký trên đĩa).
- **5b (M1b):** diff gộp ảo hoá + stage/unstage/huỷ theo hunk và dòng (patch theo byte).
- **5c (M1b):** banner thao tác dở, trình giải conflict (byte), hộp thoại, lỗi có lối thoát, menu ngữ cảnh merge/rebase/fast-forward/push/push tag.
- **5d (sau M1b, trước GA):** diff tách đôi, diff ảnh, kéo-thả.

## Context Links
- Spec Swift: `Views/Inspector/StagingView.swift`, `Views/Diff/DiffPane.swift`, `Views/Diff/ConflictResolverView.swift`, `Views/Sheets/Sheets.swift`, `Model/RepoModel+Diff.swift`, `Model/RepoModel+Actions.swift` (menu builders :1095-1132, `dropOptions` :1202, undo)
- [Red team](./plan.md#red-team-review): FM2, FM3, FM4, FM8, AD9, SC2, SC5, SA10

## Key Insights
- Diff viewer tự viết trên hunk của git (CodeMirror merge tự tính diff → lệch hunk → stage sai). Syntax highlight làm sau, chỉ tô dòng đang thấy.
- Hoàn tác của Swift chỉ sống trong toast 9 giây và chạy trên **HEAD lúc bấm** → có thể phá nhánh khác. Bản mới: nhật ký trên đĩa + ref giữ object + compare-and-swap.
- Ghi file chỉ qua RepoFs theo byte (phase 2); file không phải UTF-8 → không giải trong app.
- Mọi hành động kéo-thả đã có ở menu ngữ cảnh (Swift `dropOptions` ↔ menu builders) → MVP dùng menu; kéo-thả ở 5d.
- `dragDropEnabled` bật (nhận thả thư mục từ OS) thì HTML5 DnD không chạy trên Windows → 5d bắt đầu bằng spike 1 ngày: HTML5 DnD với `dragDropEnabled: false` (mở repo bằng dialog/icon/argv) so với pointer events tự viết; chọn theo kết quả trên 2 OS.

## Requirements
**5a**
- Staging: 2 danh sách ảo hoá, chọn nhiều, nút hiện khi hover, nhấp đúp/Space để stage-unstage, huỷ thay đổi (xác nhận + hoàn tác), "Thêm vào .gitignore" (`fs_append_gitignore`, có hoàn tác), xung đột đứng đầu.
- Composer: tóm tắt/mô tả, amend (điền message cũ), ⌘/Ctrl+Enter, "Stage tất cả & commit", thiếu danh tính → hộp thoại danh tính; chỗ cho nút AI (phase 6).
- Hoàn tác bền: mỗi thao tác phá dữ liệu ghi 1 dòng vào `<commonDir>/thaigit/undo.jsonl` `{ts, op, branch, headAfter, restore…}` + ref `refs/thaigit/undo/<ts>` giữ object (graph dùng `--branches --remotes --tags` nên không lộ ref này). Chỉ hoàn tác khi branch/HEAD còn đúng `headAfter` (`git update-ref <ref> <mới> <cũ mong đợi>`); lệch → báo, không làm. Trước khi hoàn tác `reset --hard` → `stash create` chụp working tree. Huỷ file untracked → `fs_trash_untracked` (thư mục rác của app, không phải Thùng rác OS). Dọn ref/rác > 7 ngày. Toast vẫn có nút "Hoàn tác" (đọc từ nhật ký, còn sau reload). Panel lịch sử hoàn tác: 1.x.

**5b**
- Diff gộp ảo hoá: tô sáng phần chữ đổi trong dòng, nút Stage/Huỷ/Bỏ stage cho từng hunk, chọn dòng (click, Shift+click) + thanh "Đã chọn n dòng", file lớn → "Hiển thị vẫn được", file nhị phân, Esc về graph.
- Stage/huỷ hunk + dòng: `patchBuilder` (bytes) → `git apply --cached --recount`; huỷ = áp ngược vào working tree, hoàn tác qua `stash create`.
- Cảnh báo khi huỷ dòng/hunk làm đổi cả file: với `core.autocrlf=true|input`, nếu kiểu xuống dòng của file trong working tree khác kiểu git sẽ ghi (`git ls-files --eol -- <path>`: `w/` lệch với `i/` + cấu hình), `git apply` viết lại xuống dòng của **toàn bộ file** (ma trận phase 3 đã xác nhận). Trước khi áp → hộp xác nhận nói rõ "Huỷ sẽ đổi kiểu xuống dòng của cả file sang CRLF/LF"; vẫn hoàn tác được qua `stash create`.

**5c**
- Banner merge/rebase/cherry-pick/revert: Tiếp tục/Bỏ qua/Huỷ (`operationState` qua `fs_read_git_file`).
- Conflict: danh sách file, giải theo khối (Current/Incoming/Cả hai/Base), xem trước, "Lưu & đánh dấu đã giải quyết":
  - decode `new TextDecoder('utf-8', {fatal: true})`; lỗi → chỉ cho "Mở bằng editor";
  - giữ BOM + kiểu xuống dòng; **chỉ thay byte trong vùng marker**;
  - trước khi lưu `git hash-object -w` bản cũ (hoàn tác được); ghi bằng `fs_write_worktree_file` (CAS) rồi mới `add`;
  - trường hợp không có marker (bên kia xoá…).
- Pull = fetch (huỷ được) rồi merge/rebase (không huỷ); push/fetch huỷ được; nút Huỷ gắn đúng `opId` đang chạy.
- Sau huỷ/crash: `repo_health` → banner "Gỡ khoá" cho khoá mồ côi; trạng thái dở → banner thao tác.
- Lỗi có lối thoát: checkout bị chặn → "Stash rồi checkout"; push bị từ chối → "Pull" / "Force push…"; pull lệch → chọn merge/rebase.
- Menu ngữ cảnh nhánh/tag/remote (port menu builders): merge, rebase, fast-forward, push, push tag, xoá.
- Revert kiểu GitKraken (người dùng yêu cầu 2026-10-02): menu commit "Revert commit" → hỏi "Revert & commit" / "Revert, chưa commit" / "Huỷ"; "chưa commit" = `git revert --no-commit [-m 1]` (để lại REVERT_HEAD + MERGE_MSG → banner "Đang revert" + ô commit điền sẵn message); commit merge đảo ngược so với cha thứ nhất.
- Hộp thoại: tạo/đổi tên nhánh, tạo tag, push (remote, nhánh đích, upstream, force-with-lease), stash kèm lời nhắn, thêm remote (URL kiểm như clone), danh tính, nhật ký lệnh (đã che credential; "Sao chép chẩn đoán" có xem trước), lịch sử file.

**5d**
- Diff tách đôi ảo hoá (port `DiffPresentation`: tab → 4 dấu cách, cắt 1.200 ký tự, splitRows; bỏ `\r` chỉ khi hiển thị).
- Diff ảnh: blob qua `git cat-file` / `fs_read_worktree_file` → object URL; trước/sau, kích thước pixel, không phóng quá cỡ thật.
- Kéo-thả: pill/nhánh → nhánh (merge/rebase/fast-forward), nhánh → remote (push), tag → remote (push tag), file giữa 2 danh sách staging; hộp thoại "Thả X lên Y" (port `dropOptions`); Esc để huỷ, tự cuộn ở mép.

**Non-functional:** diff 5.000 dòng cuộn mượt; stage 1 dòng < 300 ms (gồm làm mới).

## Architecture
```
apps/desktop/src/lib/
├── staging/   StagingPanel · FileList (ảo hoá) · CommitComposer · IdentityDialog
├── diff/      DiffPane · DiffHeader · UnifiedView · SplitView (5d) · HunkHeader · LineSelectionBar · ImageDiff (5d)
├── conflict/  ConflictList · ConflictResolver · OperationBanner · StaleLockBanner
├── undo/      journal.ts (nhật ký + ref + CAS + thư mục rác)
├── dnd/       (5d) dropOptions.ts · html5Drag.ts hoặc pointerDrag.ts (theo spike)
├── dialogs/   CreateBranch · RenameBranch · CreateTag · Push · Stash · AddRemote · CommandLog · FileHistory · ConfirmDialog
└── stores/    diff.svelte.ts (openFile, lineSelection, apply hunk/lines → core.patchBuilder)
```

## Related Code Files
- Create: các file trên; `tests/e2e/specs/*` cho từng lát
- Modify: `lib/stores/repo.svelte.ts` (thao tác + hoàn tác), `lib/graph/GraphView.svelte` + `lib/sidebar/*` (menu ngữ cảnh; nguồn/đích thả ở 5d)

## Implementation Steps
1. (5a) Staging panel + composer + `undo/journal.ts` + hoàn tác commit/huỷ thay đổi.
2. (5b) Diff store + UnifiedView ảo hoá; stage/huỷ hunk và dòng qua `patchBuilder` + `git apply --cached --recount`.
3. (5c) Banner + conflict resolver theo byte + health/gỡ khoá + pull tách 2 bước.
4. (5c) Menu ngữ cảnh + hộp thoại + luồng lỗi có lối thoát.
5. (5d) SplitView, ImageDiff; spike DnD 1 ngày → triển khai cách thắng.
6. E2E mỗi lát (WebdriverIO, repo tạm thật): stage 2 dòng, commit + hoàn tác, stash/pop, merge qua menu (5c) / kéo-thả (5d), conflict theirs → continue, push/pull remote cục bộ.

## Todo List
- [ ] (5a) Staging + composer + hoàn tác bền
- [ ] (5b) Diff gộp + chọn dòng + stage/huỷ hunk & dòng
- [ ] (5c) Banner + conflict resolver (byte) + gỡ khoá
- [ ] (5c) Menu ngữ cảnh + hộp thoại + luồng lỗi
- [ ] (5d) Diff tách đôi + diff ảnh
- [ ] (5d) Spike + kéo-thả
- [ ] E2E từng lát (CI 2 OS)

## Success Criteria
- [ ] (5a) Merge → chuyển nhánh → bấm hoàn tác: bị từ chối, nhánh mới không đổi; hoàn tác vẫn dùng được sau reload app
- [ ] (5a) Huỷ file untracked → hoàn tác khôi phục đúng từng byte trên 2 OS
- [ ] (5b) Stage/unstage/huỷ dòng đúng mọi ô ma trận CRLF (phase 3) trên Windows + macOS
- [ ] (5b) Huỷ dòng trên file có xuống dòng lệch `core.autocrlf` → hiện cảnh báo đổi cả file trước khi áp
- [ ] (5c) Giải conflict file có BOM/CRLF: mọi byte ngoài vùng marker giữ nguyên; file CP1252 → chỉ "Mở bằng editor"
- [ ] (5c) Huỷ pull giữa chừng không để lại khoá; nếu có → "Gỡ khoá" hiện
- [ ] Kịch bản hồi quy Swift chạy bằng E2E trên 2 OS (merge qua menu ở M1b, qua kéo-thả ở 5d)
- [ ] (5d) Kéo-thả hoạt động như nhau trên macOS và Windows

## Risk Assessment
- DnD (5d) dễ sót case (cuộn khi kéo, ra ngoài cửa sổ) → chọn qua spike; phạm vi chỉ trong cửa sổ; checklist thủ công.
- Diff rất lớn (lockfile 50k dòng) → mặc định thu gọn + "Hiển thị vẫn được"; chọn dòng chỉ trong hunk đang thấy.
- Nhật ký hoàn tác hỏng/thiếu → hoàn tác báo "không còn dữ liệu", không đoán; ref vẫn giữ object để khôi phục tay.
- Rollback: lát nào lỗi thì chưa đưa vào bản beta (M1b chỉ cần 5a–5c); revert commit.

## Security Considerations
- Nội dung file/diff hiển thị dạng text (escape); ảnh qua object URL nội bộ, không nạp URL ngoài.
- "Mở bằng editor" qua `open_in_editor` (phase 2: `.exe` thật, đường dẫn trong repo).
- Nhật ký lệnh và "Sao chép chẩn đoán" luôn đã che credential.

## Next Steps
- Phase 6 gắn nút AI vào CommitComposer, CommitDetail, menu nhánh.
