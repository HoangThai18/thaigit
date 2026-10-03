---
title: "Brainstorm: Lưới an toàn khi code bằng AI (snapshot timeline + cờ rủi ro + AI tách WIP)"
date: 2026-10-03
status: approved
apps: [tauri, swift]
modes: []
---

# Lưới an toàn khi code bằng AI

> **Cập nhật 2026-10-03:** user bỏ hướng server Hermes → bỏ đo qua thống kê server; B2 hoãn sang kế hoạch sau và không dùng Hermes. Snapshot dùng một ref + reflog mỗi worktree (`refs/worktree/thaigit/snapshots`) thay vì mỗi mốc một ref. Kế hoạch: `plans/261003-2353-ai-safety-net-snapshots/`.

## 1. Chẩn đoán (problem-first)
Câu gốc: "thiết kế tính năng gì để khác biệt thời AI coding / vibecoding". Đây là nhảy vào giải pháp — tín hiệu thật: AI commit message đã thành hàng phổ thông (GitKraken, GitHub Desktop/Copilot; Thaigit cũng có) → cần trục khác biệt mới.

## 2. Vấn đề gốc
Người code bằng agent (Cursor, Claude Code, Codex…) thay đổi nhanh, rộng, khó kiểm soát; git truyền thống chỉ bảo vệ cái đã commit.

## 3. Giả định & cách kiểm
| Giả định | Nếu sai | Kiểm |
|---|---|---|
| Người dùng thật sự mất "bản chạy được" vì agent | A vô dụng | Đếm lượt khôi phục snapshot / DAU (Tauri, opt-in) |
| Checkpoint của agent không đủ | A trùng lặp | Hỏi beta user dùng công cụ gì, có dùng /rewind không |
| Người dùng chịu duyệt đề xuất tách commit | B2 bị bỏ qua | Tỷ lệ chấp nhận đề xuất |
| Ref ẩn không làm phiền | Phàn nàn repo phình / ref lạ | Theo dõi phản hồi, đo kích thước .git |

## 4. Problem statement
- **Ai**: vibecoder không rành git + dev chuyên nghiệp dùng agent (cả hai).
- **Khổ**: agent phá code chưa commit; WIP 40 file commit một cục; không đọc nổi diff (xoá test, thêm thư viện, lộ key).
- **Hậu quả**: mất việc, lịch sử rác, revert không được, sự cố bảo mật.
- **Thành công**: khôi phục được bất kỳ trạng thái nào trong 7 ngày; WIP lớn thành vài commit có nghĩa; rủi ro hiện trước khi commit.

## 5. Ba cách nhìn / hướng đã cân
- **A. Dòng thời gian snapshot** (không AI, offline) — chọn.
- **B. Cờ rủi ro + AI tách WIP** (dùng lại engine patch theo byte) — chọn, sau A.
- **C. Bảng điều khiển agent song song (worktree)** — loại vòng này: phạm vi lớn, đấu trực diện GitButler, người dùng hẹp.

## 6. Bằng chứng
**None** — đang đoán. Do đó A (rẻ, offline) đi trước và phải đo.

## 7. Thiết kế đã chốt

### Chung
- Làm **song song Tauri + Swift** (user chọn; đã cảnh báo công ~x2, Swift theo plan cũ ngừng sau GA).
- **Đặc tả snapshot dùng chung**: `packages/contracts/snapshot-format.md` + `snapshot.vectors.json` (tên ref, metadata, luật retention) — TS, Rust, Swift test cùng vectors, giống mô hình `git-policy.vectors.json`. Lý do: cùng repo mở bằng 2 app phải thấy chung timeline và không xoá nhầm theo luật lệch.

### A. Dòng thời gian snapshot
- Kích hoạt: repo đang mở + watcher thấy đổi; debounce 20–30s yên, ≤ 1 lần / 2 phút; bỏ nếu tree trùng mốc trước.
- Cơ chế: index tạm (`GIT_INDEX_FILE`) → `add -A` (tôn trọng .gitignore) → `write-tree` → `commit-tree` (cha = HEAD) → `update-ref refs/thaigit/snap/<ts>`. Không đụng index/stash/nhánh của user.
- Retention mặc định **7 ngày / 300 mốc** (cái tới trước), chỉnh trong Cài đặt; xoá ref → gc dọn object.
- Mặc định **bật**, tắt theo repo; lần đầu hiện thông báo giải thích + nút tắt.
- UI: mục "Dòng thời gian" — thanh trượt + danh sách mốc (số file đổi), diff mốc ↔ hiện tại, khôi phục file / cả thư mục; trước khôi phục tự chụp snapshot + nút Hoàn tác.
- Bảo mật: thêm lệnh vào `git-policy.json` (giới hạn namespace `refs/thaigit/`) + vectors; kiểm ở Rust. Không chạy chương trình do repo đặt (giữ cờ `-c` chuẩn). Snapshot chứa cả file nhạy cảm chưa ignore → chỉ local, không bao giờ push / gửi AI.
- Giới hạn công khai: app đóng thì không chụp; `git push --mirror` sẽ đẩy cả ref ẩn (ghi chú).

### B1. Cờ rủi ro (luật, không AI)
Xoá / skip test; đổi manifest / lockfile phụ thuộc; sửa `.env*` / CI; nhị phân > 1 MB; đoạn trông như secret (dùng lại bộ quét sẵn có). Dải cảnh báo trên panel commit. Giống hệt 2 app.

### B2. AI tách WIP thành commit
- Tauri: Hermes; AI trả JSON nhóm hunk + message; user duyệt / kéo hunk giữa nhóm → app stage + commit tuần tự bằng engine patch theo byte; hoàn tác được. Trần kích thước diff (tôn trọng năng lực VPS); vượt → gom theo thư mục, không AI. Dữ liệu gửi đi qua bộ lọc bí mật + màn đồng ý hiện có.
- Swift: Apple Intelligence trên máy (giữ "code không rời máy"), chỉ diff nhỏ; vượt trần → gom theo thư mục.

### Ngoài phạm vi
Dịch vụ nền khi app đóng; hướng C; đẩy / đồng bộ snapshot lên remote; tiếng Anh.

## 8. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Repo lớn: `add -A` vào index tạm chậm | debounce, bỏ khi tree trùng, đo trên repo 30k commit; cân nhắc tái dùng index tạm giữa các lần |
| .git phình (build output chưa ignore) | retention, cảnh báo khi snapshot > ngưỡng MB, bỏ file > N MB |
| Lệnh ghi mới mở rộng bề mặt tấn công policy | namespace cố định, vectors chung TS/Rust, test Rust `vectors_match_reference` |
| Hai app lệch đặc tả | vectors chung, test bắt buộc ở cả 3 ngôn ngữ |
| AI chia sai | luôn duyệt trước, mọi bước hoàn tác |
| Công x2 do song song | A trước cả hai app, B sau; cắt B2 Swift nếu chậm |

## 9. Đo & tiêu chí
- Tauri (chỉ khi user bật thống kê): lượt khôi phục / DAU, % chấp nhận đề xuất tách, % repo tắt snapshot.
- Kill: sau 4 tuần beta, lượt khôi phục ≈ 0 và tỷ lệ tắt cao → thu nhỏ A về tuỳ chọn tắt sẵn, ngừng đầu tư thêm.
- Chấp nhận A: agent sửa file → trong ≤ 2 phút có mốc mới; khôi phục mốc cũ đúng từng byte (CRLF/BOM); hoàn tác khôi phục về đúng trạng thái trước; index/stash/nhánh user không đổi; ref quá 7 ngày / quá 300 bị xoá.

## 10. Bước tiếp
1. `/ck:plan` dựa trên báo cáo này: đặc tả + vectors → A (Tauri ‖ Swift) → B1 → B2.
2. Mỗi bước ghi `## Chưa phát hành` của đúng CHANGELOG.

## 11. Tin nhắn cho bên liên quan (nháp)
"Thay vì thêm một nút AI nữa, Thaigit sẽ là lưới an toàn khi code bằng AI: tự lưu mọi trạng thái thư mục trong 7 ngày, cảnh báo thay đổi rủi ro, và giúp tách WIP lớn thành commit gọn. Bắt đầu bằng dòng thời gian snapshot (offline, không tốn AI) và đo lượt khôi phục trong beta trước khi mở rộng."
