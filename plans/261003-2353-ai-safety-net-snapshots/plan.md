---
title: "Lưới an toàn khi code bằng AI: dòng thời gian snapshot + cờ rủi ro"
description: "Tự chụp snapshot thư mục làm việc vào ref ẩn mỗi worktree (kiểu stash + reflog), xem / khôi phục có hoàn tác, và cờ rủi ro theo luật trên panel commit — làm song song app Tauri và app Swift."
status: completed
priority: P1
branch: "main"
tags: [feature, frontend, backend, security]
blockedBy: []
blocks: []
created: "2026-10-03"
createdBy: "ck:plan"
source: skill
mode: "tdd"
---

# Lưới an toàn khi code bằng AI

## Overview

Nguồn: `plans/reports/brainstorm-261003-ai-safety-net.md`. Làm A (dòng thời gian snapshot) + B1 (cờ rủi ro) cho **cả Tauri và Swift**, song song.
**Ngoài phạm vi:** B2 AI tách WIP (kế hoạch sau, KHÔNG dùng Hermes), thống kê / sửa `server/` (user bỏ hướng server Hermes 2026-10-03), dịch vụ nền khi app đóng, đẩy snapshot lên remote.

## Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Lưu | Một ref mỗi worktree `refs/worktree/thaigit/snapshots`, mỗi mốc là một mục reflog (kiểu `refs/stash`). `git log --all` chỉ thấy ≤ 1 commit thừa; worktree không lẫn nhau (đã thử trên git 2.54) |
| Commit snapshot | tree của toàn bộ working tree (tôn trọng .gitignore) qua index tạm `<gitDir>/thaigit/snapshot.index`; cha = HEAD (không cha khi repo chưa có commit); message `thaigit-snapshot v1` + metadata; `--no-gpg-sign`; tác giả cố định `Thaigit <snapshot@thaigit.invalid>` |
| Khi chụp | repo đang mở, watcher báo working tree đổi; đợi yên 20 s, tối đa 1 lần / 120 s; bỏ nếu tree trùng mốc mới nhất; lỗi → bỏ qua lặng lẽ |
| Giữ | 7 ngày hoặc 300 mốc (cái tới trước), không bao giờ xoá mốc mới nhất; chỉnh trong Cài đặt |
| Mặc định | bật; tắt được theo repo; lần đầu hiện thông báo giải thích |
| Khôi phục | luôn chụp mốc "trước khôi phục" rồi mới ghi; chỉ đụng working tree (không đụng index, nhánh, stash); file tạo sau mốc → thùng rác của app; có Hoàn tác |
| Ngôn ngữ | Tauri: mọi chuỗi mới có cả `strings/<tính năng>.vi.ts` và `.en.ts` (user dặn 2026-10-04). Swift: `String(localized:)` + bản tiếng Anh trong `Resources/en.lproj` (app vừa có tiếng Anh ở commit b7b680f; `scripts/check-mac-strings.py` = 0 lỗi) |
| Đặc tả chung | `packages/contracts/snapshot.json` + `snapshot.vectors.json`, `risk-rules.vectors.json`: TS, Rust (phần policy) và Swift test cùng vectors |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Hợp đồng chung và chính sách git](./phase-01-contracts-policy.md) | Completed |
| 2 | [Lõi snapshot TS](./phase-02-core-snapshot-ts.md) | Completed |
| 3 | [Giao diện dòng thời gian Tauri](./phase-03-tauri-timeline-ui.md) | Completed |
| 4 | [Snapshot và dòng thời gian Swift](./phase-04-swift-snapshot.md) | Completed |
| 5 | [Cờ rủi ro (Tauri + Swift)](./phase-05-risk-flags.md) | Completed |
| 6 | [Kiểm tra tổng và nhật ký thay đổi](./phase-06-verify-changelog.md) | Completed |

Thứ tự: 1 → 2 → 3; 4 sau 1 (song song 2–3); 5 sau 2 và 4; 6 cuối.

## Regression gate (mọi phase)

```bash
pnpm check && pnpm lint && pnpm test
(cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test)
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk swift test \
  -Xswiftc -plugin-path -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing
```

## Dependencies

- git ≥ 2.20 (`refs/worktree/*`); Git for Windows hiện tại đáp ứng.
- Không phụ thuộc server, mạng hay AI.
