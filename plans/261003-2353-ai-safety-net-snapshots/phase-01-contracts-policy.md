---
phase: 1
title: "Hợp đồng chung và chính sách git"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Hợp đồng chung và chính sách git

## Overview
Đặc tả snapshot dùng chung (TS + Swift), mở chính sách git cho các lệnh snapshot, Rust cho phép lệnh ghi chạy nền (bỏ qua khi repo bận) và chuẩn bị thư mục index tạm.

## Key Insights (từ khảo sát + thử git 2.54)
- `GIT_INDEX_FILE` đã nằm trong `env.fromCaller` (`pathInside: gitDir`); `check_index_file` (core.rs:192) đòi thư mục cha đã tồn tại → cần lệnh chuẩn bị thư mục `<gitDir>/thaigit/`.
- `update-ref` đã được phép. Thiếu: `write-tree`, `commit-tree`, `reflog delete` (`read-tree` không cần: `add -A` vào index tạm rỗng tự dựng index).
- `commit-tree` cần danh tính → thêm `GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL` vào `fromCaller` với **giá trị cố định duy nhất**.
- `commit-tree` theo `commit.gpgSign` → gọi `gpg.program` do repo đặt. Bắt buộc `--no-gpg-sign`; chính sách **từ chối** `commit-tree` thiếu cờ này hoặc có `-S`/`--gpg-sign`.
- Khoá nền hiện chỉ cho `network` (core.rs:680). Snapshot cần: thử lấy khoá, bận thì bỏ qua; **không bị chen ngang** (giết `update-ref` giữa chừng để lại `.lock`).

## Requirements
- `packages/contracts/snapshot.json`: `ref` = `refs/worktree/thaigit/snapshots`, `indexFile` = `thaigit/snapshot.index` (tương đối git dir), `messageHeader` = `thaigit-snapshot v1`, `identity` {name `Thaigit`, email `snapshot@thaigit.invalid`}, `defaults` {quietMs 20000, minIntervalMs 120000, keepDays 7, keepCount 300}, định dạng metadata (dòng `key: value`: `reason` = `auto|before-restore|manual`, `files` = số file khác HEAD).
- `packages/contracts/snapshot.vectors.json`: ca cho (a) `parseSnapshotMessage` (message → metadata | null), (b) `selectExpired(entries, now, keepDays, keepCount)` → danh sách chỉ số reflog cần xoá (giữ mốc mới nhất; xoá từ cũ nhất).
- Chính sách: `write-tree`, `commit-tree`, `reflog` (chỉ `delete`) đều `write`; env `fromCaller` danh tính cố định. Không cần `requireAll` cho `--no-gpg-sign`: `commit` vốn đã được phép và chương trình gpg của repo chưa tin đã bị Rust ghim (trust.rs); app luôn tự thêm `--no-gpg-sign` để khỏi bật hộp ký mỗi 2 phút.
- Rust: `EnvProfile::Background` + `ExecKind::Write` → `try_acquire` (Busy → lỗi `busy`, frontend bỏ qua), holder **không** đánh dấu preemptible.
- Rust command `fs_snapshot_index_prepare(repoId, reset: bool) -> String`: tạo `<gitDir>/thaigit/` nếu thiếu; `reset` xoá `snapshot.index` + `snapshot.index.lock` (chỉ đúng 2 file đó); trả đường dẫn tuyệt đối index tạm. Adapter Node (`packages/core/src/node`) làm giống hệt.

## Related Code Files
- Create: `packages/contracts/snapshot.json`, `packages/contracts/snapshot.vectors.json`, `packages/contracts/src/snapshot.ts`, `packages/contracts/test/snapshot.test.ts`
- Modify: `packages/contracts/git-policy.json`, `git-policy.vectors.json`, `src/policy.ts`, `src/index.ts`, `package.json` (exports), `README.md` (mục chính sách)
- Modify: `apps/desktop/src-tauri/src/policy.rs` (requireAll/rejectExtra cho commit-tree nếu cần), `core.rs` (khoá nền cho write), `locks.rs` (try-lock không chen), `repo_fs.rs` + `commands.rs` + `lib.rs` (fs_snapshot_index_prepare)
- Modify: `packages/core/src/ports/repo-fs.ts`, `packages/core/src/node/*` (adapter), `apps/desktop/src/lib/core-tauri.ts`, `apps/desktop/src/lib/platform/dev-bridge-client.ts` (cầu nối DEV chỉ-đọc → báo không hỗ trợ)

## Implementation Steps (TDD)
**Tests Before**
1. Thêm ca vào `git-policy.vectors.json`: cho phép `read-tree HEAD`, `write-tree`, `commit-tree <tree> -p HEAD --no-gpg-sign`, `reflog delete --rewrite --updateref refs/worktree/thaigit/snapshots@{3}`; từ chối `commit-tree <tree>` (thiếu cờ), `commit-tree -S …`, `reflog expire …`, `reflog show`; `kinds` cho 4 lệnh = `write`. Chạy test TS + Rust → đỏ.
2. `snapshot.test.ts` đọc `snapshot.vectors.json` → đỏ.
3. Rust test: background write khi repo bận → `busy`, không chờ; khi đang chạy không bị op thường giết. Test `fs_snapshot_index_prepare` (tạo thư mục, reset chỉ xoá 2 file, worktree dùng git dir riêng).
4. Test env: `GIT_AUTHOR_NAME=Thaigit` được nhận, giá trị khác bị từ chối.

**Refactor / Implement**
5. Sửa `git-policy.json` (+ field mới nếu policy chưa có `requireAll`: thêm ở cả TS `validateGitCommand` và Rust `validate`, cập nhật `$comment`).
6. Viết `src/snapshot.ts`: hằng từ JSON, `parseSnapshotMessage`, `formatSnapshotMessage`, `selectExpired`.
7. Rust: khoá nền cho write; command prepare; đăng ký trong `lib.rs`.

**Tests After**: toàn bộ vectors xanh ở TS và Rust (`vectors_match_reference`).

## Success Criteria
- [ ] Vectors mới xanh ở TS và Rust, kết quả giống hệt.
- [ ] `commit-tree` không có `--no-gpg-sign` bị từ chối ở cả hai bên.
- [ ] Lệnh ghi nền không bao giờ xếp hàng chờ và không bị giết giữa chừng.
- [ ] Regression gate xanh.

## Risk Assessment
- Mở rộng bề mặt chính sách → chỉ dạng hẹp (`reflog delete`), giá trị env cố định, vectors chung.
- `requireAll` là khái niệm mới của policy → giữ tối giản, có ca test âm.

## Security Considerations
- Không chạy chương trình do repo đặt: `--no-gpg-sign` bắt buộc; repo chưa tin vẫn qua chế độ hạn chế có sẵn (hooksPath rỗng, ghi đè khoá chạy lệnh); repo `fail_closed` → lệnh ghi bị chặn → snapshot bỏ qua.
- `fs_snapshot_index_prepare` chỉ thao tác đúng đường dẫn cố định trong git dir, kiểm realpath như `repo_fs`.
