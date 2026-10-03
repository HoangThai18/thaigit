---
phase: 6
title: "Kiểm tra tổng và nhật ký thay đổi"
status: completed
priority: P1
dependencies: [3, 4, 5]
---

# Phase 6: Kiểm tra tổng và nhật ký thay đổi

## Steps
1. Regression gate đủ (plan.md) + `pnpm format`.
2. Đo trên repo lớn (30k commit): thời gian `take` lần đầu và lần sau; ghi kết quả vào báo cáo.
3. Kiểm tay: app Tauri qua cầu nối DEV / bản build; app Swift `./scripts/build-app.sh --debug`; mở cùng repo ở hai app thấy chung mốc.
4. Ghi `## Chưa phát hành` ở `CHANGELOG.md` (macOS) và `apps/desktop/CHANGELOG.md` (Tauri), viết cho người dùng cuối; README phần tính năng.
5. Commit theo quy ước (`App macOS: …`, `Bản đa nền tảng: …`), add từng file, không phát hành.

## Success Criteria
- [ ] Mọi lệnh kiểm xanh; changelog đủ cả hai app.

## Kết quả (2026-10-04)
- Gate: pnpm check / lint sạch; test TS 165 + 24 + 572 + 416; Rust clippy sạch, 269 test; Swift 181 test; check-mac-strings 0 lỗi.
- Đo (repo 648 file): `add -A` vào index tạm lần đầu 0,22 s, các lần sau 0,01 s. Chưa đo repo 30k commit (không có sẵn trên máy).
- Kiểm tay: panel Tauri trên trình duyệt (cầu nối DEV) cả vi / en. App Swift: chỉ build `build/Thaigit.app`, chưa mở xem.
