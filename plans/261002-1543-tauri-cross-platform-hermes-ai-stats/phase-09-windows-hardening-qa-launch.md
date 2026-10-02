---
phase: 9
title: "Windows Hardening QA & Launch"
status: pending
priority: P1
effort: "4-6 ngày (+ cửa sổ beta ≥ 7 ngày theo lịch, không tính công)"
dependencies: [5, 6, 8]
---

# Phase 9: Windows Hardening, QA & Launch (GA)

## Overview
Trước GA: QA theo ma trận gọn, E2E app thật trên 2 OS, hiệu năng, rà bảo mật + quyền riêng tư, cửa sổ beta ≥ 7 ngày, phát hành GA (dự kiến 2.0.x — câu hỏi mở 4), quyết định ngừng app Swift.

## Context Links
- Kịch bản hồi quy từ bản Swift (`Sources/Nhanh/Debug/AutomationHarness.swift`): mở diff, chọn 2 dòng → stage, commit + hoàn tác, stash/pop, merge, conflict theirs → continue, push/pull remote cục bộ, tự làm mới khi sửa file ngoài, repo 30k commit
- [Generator repo lớn](./research/make-big-repo.py) · [Red team](./plan.md#red-team-review): SC6, AD10, SA1, SA4/AD3, AD2

## Key Insights
- E2E chỉ **một lớp**: WebdriverIO + `@wdio/tauri-service` (WebDriver nhúng trong app, chạy cả macOS lẫn Windows) với repo tạm thật — harness có từ 4a. Không Playwright, không IPC giả, không fixture ghi sẵn output git.
- Lỗi Windows hay gặp với git client: CRLF trong index, đường dẫn tiếng Việt/dài, OneDrive, Defender chậm, GCM/SSH, locale không phải tiếng Anh — mỗi loại một case.

## Requirements
- Ma trận (gọn, một người làm được): Windows 11 + Git for Windows mới nhất (autocrlf true/false + repo có CRLF trong index), DPI 100/150%, sáng/tối/không kính; macOS bản của chủ dự án (Apple Silicon) + Homebrew git và Apple git. Windows 10 (hết hỗ trợ từ 14/10/2025), Mac Intel, git cũ: nhờ báo lỗi từ beta.
- Hiệu năng (`reports/perf-final.md`): repo 30k commit / 1.077 ref mở < 1,5 s; cuộn 60 fps; sự kiện file → bắt đầu làm mới < 400 ms (thời gian `status` ghi riêng); RAM rảnh < 300 MB; so GitKraken cùng máy *(tham khảo)*.
- Bảo mật: payload XSS (trong commit message, tên nhánh, output AI) không thể gọi `git_exec` với argv/env nguy hiểm; validator từ chối đủ danh sách phase 2; repo lạ không chạy hook/filter trước khi tin tưởng; `open_url` chặn scheme lạ; CSP + capabilities; `cargo audit`, `pnpm audit` (biết rằng audit không bắt được gói độc).
- Quyền riêng tư: payload AI không có file/đoạn bị loại; không `aiInstallId` khi chưa đồng ý AI; không `telemetryId` khi chưa opt-in; server không lưu nội dung; log proxy không có IP cho `/v1/*`; trang privacy khớp thực tế (kể cả vị trí VPS).
- Truy cập cơ bản: điều hướng bàn phím toàn app, focus ring rõ, nhãn cho nút chỉ có icon.

## Architecture
```
tests/
├── e2e/   (WebdriverIO + @wdio/tauri-service, có từ 4a) ← CI macOS + Windows: hồi quy + bảo mật + cập nhật
└── perf/  (script đo + make-big-repo.py)
```

## Related Code Files
- Create: `tests/perf/**`, `reports/perf-final.md`, `docs/qa-checklist.md`; thêm specs vào `tests/e2e/`
- Modify: sửa lỗi phát sinh ở `apps/desktop/**`, `packages/**`, `server/**`
- Retire (sau GA, khi user đồng ý): chuyển app Swift vào `legacy/macos-swift/` hoặc tách repo; bản Swift cuối thông báo/chuyển sang bản mới (câu hỏi mở 4)

## Implementation Steps
1. `docs/qa-checklist.md` từ kịch bản hồi quy Swift + ma trận; chạy tay trên Windows thật + Mac.
2. Bổ sung E2E: stage dòng, commit + hoàn tác, stash, merge (menu + kéo-thả), conflict, AI với server giả, cập nhật (manifest cục bộ), bảo mật XSS → `git_exec`.
3. Đo hiệu năng repo 30k; profile (DevTools trên WebView2, Safari Web Inspector trên WKWebView); tối ưu chỗ nghẽn.
4. Rà bảo mật + quyền riêng tư theo danh sách trên.
5. Cửa sổ beta ≥ 7 ngày trên kênh beta (5–20 người qua GitHub Releases/landing); phản hồi qua GitHub Issues (dùng "Sao chép chẩn đoán" đã che credential); theo dõi dashboard: lỗi AI, `ai_busy`, tỉ lệ cập nhật.
6. GA: promote lên `desktop-stable`, changelog, thông báo; quyết định ngừng app Swift (chỉ khi user đồng ý).

## Todo List
- [ ] QA checklist + chạy tay Windows/Mac
- [ ] Bổ sung E2E (hồi quy, bảo mật, cập nhật) xanh CI 2 OS
- [ ] Perf report + tối ưu
- [ ] Rà bảo mật & quyền riêng tư
- [ ] Cửa sổ beta ≥ 7 ngày + sửa lỗi
- [ ] GA; quyết định ngừng app Swift

## Success Criteria
- [ ] 100% mục QA checklist đạt trên Windows 11 + macOS của chủ dự án
- [ ] E2E xanh trên CI 2 OS (gồm test bảo mật)
- [ ] Đạt mọi ngưỡng hiệu năng; report lưu trong `reports/`
- [ ] Không còn lỗi nghiêm trọng mở; beta ổn ≥ 7 ngày

## Risk Assessment
- Lỗi chỉ có trên máy thật (AV, OneDrive, chính sách công ty) → beta đa dạng máy; "Sao chép chẩn đoán" (đã che).
- Kéo dài vì thêm tính năng → khoá phạm vi GA = MVP (M1b) + 5d + AI (M2) + thống kê/landing (M3); phần còn lại vào 1.x.
- Rollback: GA chỉ là promote kênh; rút bằng `--yank` (phase 8).

## Security Considerations
- `cargo audit` / `pnpm audit` trong CI; cập nhật Tauri thường xuyên (bản vá webview).
- Kiểm lại capabilities + CSP + validator trước GA.

## Next Steps
- 1.x: tab trong app, tiếng Anh, "Mở bằng…" nhiều app, panel lịch sử hoàn tác, interactive rebase, blame, submodule/LFS, ký commit, tích hợp PR (GitHub/GitLab), bản Linux, BYOK.
