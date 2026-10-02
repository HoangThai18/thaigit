---
phase: 1
title: "Foundation & Branding"
status: pending
priority: P1
effort: "2-3 ngày"
dependencies: []
---

# Phase 1: Foundation & Branding

## Overview
Dựng monorepo cho Thaigit (Tauri 2 + Svelte 5 + TS + server + site) cạnh app Swift hiện có, đổi tên sản phẩm thành Thaigit, tạo bộ icon từ logo Muse, và CI chạy được trên macOS + Windows ngay từ đầu.

## Context Links
- [Port inventory](./reports/scout-report.md) · [Tauri research](./research/researcher-01-tauri-desktop-report.md)
- App Swift hiện tại: thư mục gốc repo (SwiftPM, `scripts/build-app.sh`, `Resources/Info.plist`)

## Key Insights
- Thư mục `git/` đang **chưa có repo git riêng** (nằm untracked trong repo cha `Documents/code`). Release + CI cần repo GitHub riêng.
- Logo Muse là ảnh blob 1024–1600px. `tauri icon <png>` sinh đủ `.icns`, `.ico` và các cỡ PNG. Ảnh nguồn phải vuông, ≥1024px, có alpha nếu muốn bo góc.
- Icon macOS cần phần đệm theo lưới Apple (squircle khoảng 824/1024). Icon Windows nên chiếm gần hết khung. Có thể cần 2 file nguồn.

## Requirements
- Functional: `pnpm dev` mở cửa sổ Thaigit (Tauri) hiển thị "Hello"; `pnpm test` chạy Vitest; `cargo test` chạy; CI xanh trên macOS-14 (arm64) + windows-latest.
- Branding: tên hiển thị "Thaigit", identifier `com.phanthai.thaigit` (chờ xác nhận), icon từ logo đã chọn trên cả 2 OS.
- Non-functional: TypeScript strict, ESLint + Prettier, Rust clippy; Node 22 LTS, pnpm 9+, Rust stable.

## Architecture
```
git/                         (repo root — tách thành repo GitHub "thaigit")
├── Package.swift, Sources/, Tests/, Resources/, scripts/   ← app Swift (giữ nguyên, đổi tên hiển thị)
├── apps/desktop/            ← Tauri 2: src-tauri/ (Rust) + src/ (Svelte 5)
├── packages/core/           ← TS core (phase 3), Vitest
├── server/                  ← Hono API (phase 7)
├── site/                    ← landing (phase 8)
├── brand/                   ← logo gốc từ Muse, icon-source.png, icon-source-windows.png
├── package.json, pnpm-workspace.yaml, .github/workflows/ci.yml
```

## Related Code Files
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.editorconfig`, `apps/desktop/**` (scaffold `pnpm create tauri-app` → Svelte + TS), `packages/core/package.json`, `brand/`, `.github/workflows/ci.yml`
- Modify (đổi tên app Swift): `Resources/Info.plist` (CFBundleName/DisplayName → Thaigit, bundle id), `scripts/build-app.sh` (APP="build/Thaigit.app", exec), `Sources/Nhanh/Views/WelcomeView.swift` (tiêu đề), `Sources/NhanhCore/Git/GitEnvironment.swift` (tiêu đề askpass "Thaigit", thư mục Application Support), `README.md`, `.gitignore` (node_modules, target, dist)
- Không đổi tên module Swift (Nhanh/NhanhCore) — app Swift sẽ ngừng sau, tránh xáo trộn.

## Implementation Steps
1. `git init` trong `git/`, commit hiện trạng (chỉ khi user yêu cầu commit — xem memory "no auto-commit"); tạo repo GitHub `thaigit` (public/private theo quyết định validate).
2. pnpm workspace + `apps/desktop` scaffold Tauri 2 (Svelte 5 + TS + Vite). Cấu hình `tauri.conf.json`: productName "Thaigit", identifier, window 1440×900 min 1000×640, `decorations` mặc định, macOS `titleBarStyle: Overlay` (toolbar liền khung như GitKraken) — kiểm tra trên Windows dùng custom titlebar hay mặc định.
3. `packages/core` rỗng + Vitest; `apps/desktop` import `@thaigit/core`.
4. Branding: lưu logo đã chọn vào `brand/` (bản gốc + bản 1024 đã crop); chạy `pnpm tauri icon brand/icon-source.png`; kiểm tra icon 16/32px còn đọc được (nếu nhòe, xin Muse bản đơn giản cho cỡ nhỏ).
5. Đổi tên app Swift sang Thaigit (các file ở trên), build lại `./scripts/build-app.sh`, chạy test Swift (40 test phải xanh).
6. CI `ci.yml`: matrix {macos-14, windows-latest}: pnpm install → lint → `pnpm -r test` → `cargo test` → `tauri build --debug` (không ký). Cache pnpm + cargo.
7. Thiết lập i18n khung (svelte-i18n hoặc Paraglide): `vi` mặc định, `en` (stretch nhưng dựng khung ngay để không phải sửa chuỗi về sau).

## Todo List
- [ ] Repo + workspace + scaffold Tauri chạy được trên macOS
- [ ] Chạy được trên Windows (máy thật hoặc VM/CI artifact)
- [ ] Logo → `brand/` → bộ icon cả 2 OS
- [ ] App Swift đổi tên Thaigit, test xanh
- [ ] CI matrix xanh
- [ ] Khung i18n vi/en

## Success Criteria
- [ ] `pnpm tauri dev` mở cửa sổ "Thaigit" có icon mới trên macOS và Windows
- [ ] CI xanh trên cả 2 OS trong < 15 phút
- [ ] App Swift build ra `build/Thaigit.app`, 40 test xanh

## Risk Assessment
- Logo AI có chi tiết mảnh (ống kính, highlight) → nhòe ở 16px. Giảm thiểu: xin Muse thêm biến thể "simplified small-size"; dùng bản đơn giản cho 16/32px (`.ico` chứa nhiều cỡ).
- Điều khoản dùng ảnh Muse cho thương mại/thương hiệu: kiểm tra ToS của muse.ai; giữ prompt + lịch sử chat làm bằng chứng nguồn gốc.
- Trùng tên "Thaigit": kiểm tra GitHub/npm/tên miền trước khi công bố.

## Security Considerations
- Không commit secret; thêm `.env*` vào `.gitignore` ngay từ đầu.

## Next Steps
- Phase 2 (Rust bridge) dùng workspace này.
