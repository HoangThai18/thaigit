---
phase: 9
title: "Windows Hardening QA & Launch"
status: pending
priority: P1
effort: "5-7 ngày"
dependencies: [5, 6, 8]
---

# Phase 9: Windows Hardening, QA & Launch

## Overview
Đảm bảo Thaigit chạy chắc trên Windows lẫn macOS trước khi công bố 1.0:
- Ma trận kiểm thử Windows.
- Bộ test E2E/UI tự động.
- Đo hiệu năng trên repo lớn.
- Kiểm tra quyền riêng tư.
- Phát hành 1.0.
- Ngừng app Swift cũ.

## Context Links
- Kịch bản hồi quy từ bản Swift (AutomationHarness): mở diff, chọn 2 dòng → stage, commit + hoàn tác, stash/pop, kéo merge, conflict theirs → continue, push/pull với remote cục bộ, tự làm mới khi sửa file ngoài, repo 30k commit
- [Generator repo lớn](./research/make-big-repo.py)

## Key Insights
- `tauri-driver` (WebDriver) chạy được trên Windows/Linux, **không** chạy trên macOS. Nên dùng 2 lớp: (1) Playwright chạy UI trong trình duyệt với IPC giả (`@tauri-apps/api/mocks`) cho mọi luồng UI, cả 2 OS; (2) WebdriverIO + tauri-driver trên Windows CI để smoke test app thật.
- Lỗi Windows hay gặp với git client: CRLF/autocrlf, đường dẫn tiếng Việt/dấu cách/dài, OneDrive, Defender làm chậm, GCM/SSH. Mỗi loại cần một case kiểm thử cụ thể.

## Requirements
- Ma trận Windows: Win 10 22H2 + Win 11; Git for Windows 2.4x mới nhất và một bản cũ (≥ 2.35); `core.autocrlf` true/input/false; repo trong thư mục có dấu tiếng Việt + dấu cách; đường dẫn > 260 ký tự (`core.longpaths`); repo trong OneDrive; HTTPS qua Git Credential Manager; SSH có passphrase (askpass) và qua ssh-agent; màn hình 100/125/150% DPI; giao diện sáng/tối.
- macOS: Apple Silicon + Intel (universal), macOS 14/15/26; cài từ DMG notarize/không notarize; Homebrew git và Apple git.
- Hiệu năng (ghi `reports/perf-final.md`): repo 30k commit / 1.100 ref mở dưới 1,5 s; cuộn 60 fps; làm mới sau khi lưu file dưới 300 ms (repo vừa); RAM rảnh dưới 300 MB; so sánh với GitKraken trên cùng máy *(tham khảo)*.
- Quyền riêng tư: kiểm payload AI (không có file bị loại trừ), không gửi `X-Install-Id` khi chưa đồng ý, server không lưu nội dung, trang privacy khớp thực tế.
- Khả năng truy cập cơ bản: điều hướng bàn phím toàn app, focus ring rõ, nhãn cho trình đọc màn hình ở nút chỉ có icon.

## Architecture
```
tests/
├── ui/ (Playwright + mock IPC)      ← chạy trên CI macOS + Windows, dùng fixture repo đã ghi sẵn output git
├── e2e-windows/ (WebdriverIO + tauri-driver)  ← smoke trên app thật: mở repo, stage, commit, kéo merge
└── perf/ (script đo + make-big-repo.py)
```

## Related Code Files
- Create: `tests/ui/**`, `tests/e2e-windows/**`, `tests/perf/**`, `.github/workflows/e2e.yml`, `reports/perf-final.md`, `docs/qa-checklist.md`
- Modify: sửa lỗi phát sinh ở `apps/desktop/**`, `packages/core/**`, `server/**`
- Retire (sau 1.0, khi user đồng ý): chuyển app Swift vào `legacy/macos-swift/` hoặc tách repo, cập nhật README

## Implementation Steps
1. Viết `docs/qa-checklist.md` từ kịch bản hồi quy Swift + ma trận Windows; chạy thủ công trên Windows thật (máy hoặc VM) và Mac.
2. Playwright UI tests với IPC giả: 10–15 luồng chính (mở repo, chọn commit, diff, stage dòng, commit + hoàn tác, stash, kéo-thả merge, conflict, AI viết commit với server giả, cập nhật).
3. WebdriverIO + tauri-driver trên `windows-latest`: smoke với repo thật tạo trong job.
4. Đo hiệu năng bằng repo 30k; profile (Chrome DevTools trên WebView2, Safari Web Inspector trên WKWebView); tối ưu chỗ nghẽn.
5. Kiểm tra quyền riêng tư (payload, header, log server) và bảo mật (CSP, capabilities, `cargo audit`, `pnpm audit`).
6. Beta mở rộng (5–20 người dùng) qua landing, thu phản hồi (form/link GitHub Issues), theo dõi dashboard: lỗi AI, tỉ lệ cập nhật, crash *(stretch: endpoint báo lỗi có đồng ý)*.
7. Phát hành 1.0: changelog, thông báo; quyết định ngừng app Swift (chỉ khi user đồng ý).

## Todo List
- [ ] QA checklist + chạy tay Windows/Mac
- [ ] Playwright UI tests (CI 2 OS)
- [ ] tauri-driver smoke (Windows CI)
- [ ] Perf report + tối ưu
- [ ] Kiểm tra quyền riêng tư & bảo mật
- [ ] Beta + sửa lỗi
- [ ] Phát hành 1.0, ngừng app Swift

## Success Criteria
- [ ] 100% mục QA checklist đạt trên Win 11 + macOS 15/26
- [ ] UI tests + E2E xanh trên CI
- [ ] Đạt mọi ngưỡng hiệu năng; report lưu trong `reports/`
- [ ] Không còn lỗi mức nghiêm trọng mở; beta dùng ổn ≥ 1 tuần

## Risk Assessment
- Lỗi chỉ xuất hiện trên máy thật (AV, OneDrive, chính sách công ty). Giảm thiểu: beta đa dạng máy; log chẩn đoán (nhật ký lệnh git) người dùng có thể copy gửi.
- Kéo dài vô hạn vì "thêm tính năng". Giảm thiểu: khoá phạm vi 1.0 = tương đương bản Swift + AI commit + cập nhật/thống kê; phần còn lại vào 1.x.

## Security Considerations
- `cargo audit` / `pnpm audit` trong CI; cập nhật Tauri thường xuyên (bản vá webview).
- Kiểm tra lại capabilities + CSP trước 1.0.

## Next Steps
- 1.x: interactive rebase, blame, submodule/LFS, ký commit, tích hợp PR (GitHub/GitLab), Linux build *(Tauri hỗ trợ sẵn)*.
