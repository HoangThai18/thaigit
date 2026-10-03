---
phase: 2
title: "Lõi snapshot TS"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: Lõi snapshot TS

## Overview
`packages/core/src/git/snapshot.ts`: chụp, liệt kê, so sánh, khôi phục (có hoàn tác), dọn mốc cũ — chạy qua `GitRunner` như `repository.ts`, test bằng git thật (adapter Node).

## Architecture
```
take(reason):
  idx = repoFs.prepareSnapshotIndex(reset=false)
  nếu idx chưa tồn tại: read-tree HEAD (repo chưa commit: read-tree --empty)   [env GIT_INDEX_FILE, profile background]
  add -A                                     [GIT_INDEX_FILE]  — lỗi ".lock" → prepare(reset=true) rồi thử lại 1 lần
  tree = write-tree                          [GIT_INDEX_FILE]
  nếu tree == tree của mốc mới nhất → trả mốc đó (không tạo mới)
  sha = commit-tree tree [-p HEAD] --no-gpg-sign  (stdin = formatSnapshotMessage)   [env danh tính cố định]
  update-ref --create-reflog -m "thaigit-snapshot" refs/worktree/thaigit/snapshots sha
list(): log -g --format=%H%x1f%T%x1f%ct%x1f%B%x00 -z refs/worktree/thaigit/snapshots  → SnapshotEntry[] (index reflog, sha, tree, time, meta)
compare(a, b): diff --name-status -z (dùng changedFiles có sẵn) giữa hai commit snapshot
restore(target, paths | 'all'):
  pre = take('before-restore')
  changes = diff target → pre (name-status)
  added-since-target (A) & chưa track → repoFs.trashUntracked → token
  còn lại → restore --source=target --worktree --pathspec-from-file=- --pathspec-file-nul
  trả { pre, trashToken } để Hoàn tác = restore(pre, cùng paths) + restoreTrash(token)
prune(now, keepDays, keepCount): selectExpired(list) → reflog delete --rewrite --updateref ref@{n} (từ n lớn xuống)
```
- `GIT_LITERAL_PATHSPECS=1` khi truyền path.
- Mọi lệnh snapshot dùng profile `background` và kind `write` (bận → `busy` → bỏ qua; riêng `restore` do người dùng bấm thì dùng profile thường).

## Related Code Files
- Create: `packages/core/src/git/snapshot.ts`, `packages/core/test/snapshot.test.ts`
- Modify: `packages/core/src/git/index.ts`, `packages/core/src/index.ts` (export), có thể `models.ts` (kiểu `SnapshotEntry`)

## Implementation Steps (TDD)
**Tests Before** (repo tạm, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`)
1. take: tạo mốc chứa cả file chưa track, tôn trọng .gitignore; index/stash/nhánh người dùng không đổi (`git status --porcelain` trước = sau, `git diff --cached` trống).
2. take hai lần không đổi gì → một mốc. Repo chưa có commit → mốc không cha. Worktree khác không thấy mốc.
3. `commit.gpgSign=true` + `gpg.program=/bin/false` trong repo → vẫn chụp được.
4. Stale `snapshot.index.lock` → tự reset rồi chụp được.
5. restore file: nội dung đúng từng byte (CRLF, BOM, nhị phân); file tạo sau mốc vào thùng rác; Hoàn tác trả đúng trạng thái trước.
6. restore all: file đã track bị xoá sau mốc được trả lại; file mới chưa track vào thùng rác; index không đổi.
7. prune: theo `snapshot.vectors.json` + kiểm trên reflog thật (giữ mốc mới nhất).

**Implement**: viết `snapshot.ts` tới khi xanh.

**Regression gate**: `pnpm --filter @thaigit/core test && pnpm check`.

## Success Criteria
- [ ] Mọi ca trên xanh; không lệnh nào ngoài chính sách (adapter Node áp cùng policy).
- [ ] Không đụng index / stash / nhánh / HEAD của người dùng.

## Risk Assessment
- Repo lớn: `add -A` lần đầu (sau read-tree) phải hash toàn bộ → chậm một lần; các lần sau dùng stat cache của index tạm. Đo trên repo 30k commit ở phase 6.
- File lớn chưa ignore (video, build) phình .git → ghi chú trong phần giới hạn; cân nhắc trần ở bản sau.
