---
phase: 4
title: "Snapshot và dòng thời gian Swift"
status: completed
priority: P1
dependencies: [1]
---

# Phase 4: Snapshot và dòng thời gian Swift

## Overview
Cùng đặc tả với Tauri: `NhanhCore` có `GitRepository+Snapshots.swift`, app có lập lịch theo `RepoWatcher` và màn Dòng thời gian.

## Architecture
- `Sources/NhanhCore/Git/GitRepository+Snapshots.swift`: hằng giống `snapshot.json` (ghi cứng, test đối chiếu vectors), `takeSnapshot`, `snapshots()`, `compareSnapshots`, `restoreSnapshot`, `pruneSnapshots`, `SnapshotMessage.parse/format`, `SnapshotRetention.selectExpired`. Env `GIT_INDEX_FILE` + danh tính cố định qua `GitRunner` (kiểm cách `GitEnvironment.swift` đặt env); `--no-gpg-sign`.
- File chưa track tạo sau mốc: dời vào thùng rác `<commonDir>/thaigit/trash/<thời điểm>/` (cùng chỗ với bản Tauri), Hoàn tác trả lại.
- App: `RepoModel+Snapshots.swift` (lập lịch: yên 20 s, tối thiểu 120 s, bỏ khi đang chạy thao tác), `Views/Inspector/TimelineView.swift` (hoặc sheet), mục Cài đặt, nút trong panel WIP + bảng lệnh ⌘P.
- Lỗi qua `FriendlyError.swift`.

## Related Code Files
- Create: `Sources/NhanhCore/Git/GitRepository+Snapshots.swift`, `Tests/NhanhCoreTests/SnapshotTests.swift`, `Sources/Nhanh/Model/RepoModel+Snapshots.swift`, `Sources/Nhanh/Views/Inspector/TimelineView.swift`
- Modify: `RepoModel.swift` (nối watcher), `SettingsView.swift`, `CommandPalette.swift`, view panel WIP, `FriendlyError.swift`

## Implementation Steps (TDD)
**Tests Before** (`TestSupport.swift`: cô lập git): các ca giống phase 2 + test đọc `packages/contracts/snapshot.vectors.json` (đường dẫn từ `#filePath`) cho parse message và retention. Mốc chụp bởi Swift được TS đọc và ngược lại (cùng ref, cùng định dạng message).
**Implement** lõi → app.
**Regression gate**: `swift test` (lệnh SDK ở plan.md) + `./scripts/build-app.sh --debug`.

## Success Criteria
- [ ] Vectors chung xanh ở Swift.
- [ ] Mở cùng repo bằng hai app thấy chung dòng thời gian; dọn mốc cùng luật.
