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
Dựng monorepo Tauri cạnh app Swift, CI 2 OS, file chính sách git dùng chung, và khởi động thủ tục mua sắm (ký code, tên miền). Phần thương hiệu + đổi tên app Swift **đã xong** (2026-10-02). Thuộc mốc **M1a**. Không bị chặn bởi câu hỏi mở nào (identifier có giá trị mặc định, đổi được tới trước M1b).

## Context Links
- [Port inventory](./reports/scout-report.md) · [Tauri research](./research/researcher-01-tauri-desktop-report.md) · [Red team](./plan.md#red-team-review)
- App Swift: `Package.swift`, `scripts/build-app.sh`, `scripts/release.sh`, `scripts/release-tool.swift`, `scripts/make-icons.py`, `Resources/Info.plist`

## Hiện trạng (2026-10-02)
- Repo **public** `github.com/HoangThai18/thaigit` đã tạo + push.
- App Swift: tên Thaigit, bundle id `com.phanthai.thaigit`, build ra `build/Thaigit.app`, 48 test xanh; tự cập nhật qua GitHub Releases (`update.json` ký Ed25519, `scripts/release.sh … --publish`); kính Liquid Glass macOS 26, màu `#2F86E8` / `#F05032` (`Sources/Nhanh/Views/Theme.swift`).
- Logo: `brand/thaigit-logo-source.png` (Muse, mẫu 2, nhánh cam đỏ); icon nguồn `brand/thaigit-icon-macos.png` (đệm theo lưới Apple) và `brand/thaigit-icon-square.png` (Windows/cỡ nhỏ), sinh bằng `scripts/make-icons.py`.
- Module Swift vẫn tên `Nhanh`/`NhanhCore` (không đổi — app Swift ngừng sau GA).

## Requirements
- `pnpm tauri dev` mở cửa sổ "Thaigit" trên macOS + Windows; `pnpm test` chạy Vitest; `cargo test` chạy; CI xanh trên `macos-14` (arm64) + `windows-latest`.
- Identifier Tauri mặc định `com.phanthai.thaigit.desktop` (khác app Swift → chạy song song không va chạm LaunchServices/dữ liệu); chốt trước M1b (câu hỏi mở 4). Phiên bản bắt đầu `2.0.0`, SemVer số thường ("beta" là kênh, không phải hậu tố).
- Toolchain ghim: Node 22 LTS (`.nvmrc`), pnpm 9+ (`packageManager`), Rust stable ghim trong `rust-toolchain.toml`, `rust-version` ≥ 1.77.2 trong `Cargo.toml` (bản vá BatBadBut).
- TS strict, ESLint + Prettier, `cargo clippy -D warnings`.
- Chỉ tiếng Việt khi ra mắt: chuỗi UI gom trong `apps/desktop/src/lib/strings.vi.ts` (object có kiểu, không thư viện i18n) để tách ra sau.

## Architecture
```
(repo root, public: HoangThai18/thaigit)
├── Package.swift, Sources/, Tests/, Resources/, scripts/   ← app Swift (chỉ sửa lỗi)
├── apps/desktop/            ← Tauri 2: src-tauri/ (Rust) + src/ (Svelte 5)
├── packages/core/           ← TS core (phase 3), Vitest
├── packages/contracts/      ← hợp đồng API (zod) + git-policy.json (TS và Rust cùng đọc)
├── server/                  ← Hono API (phase 7)
├── site/                    ← landing (phase 8b)
├── brand/                   ← thaigit-logo-source.png, thaigit-icon-macos.png, thaigit-icon-square.png
├── package.json, pnpm-workspace.yaml, rust-toolchain.toml, .github/workflows/ci.yml
```

## Related Code Files
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.editorconfig`, `rust-toolchain.toml`, `apps/desktop/**` (scaffold), `packages/core/package.json`, `packages/contracts/{package.json,git-policy.json,src/index.ts}`, `.github/workflows/ci.yml`
- Modify: `.gitignore` (thêm `node_modules/`, `target/`, `dist/`; `.env*` đã có)
- Đã xong (không làm lại): `Resources/Info.plist`, `scripts/build-app.sh`, `WelcomeView.swift`, `GitEnvironment.swift`, `README.md`

## Implementation Steps
1. Workspace: root `package.json` (`"packageManager": "pnpm@9.x"`, script `dev`/`test`/`lint`/`build`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `server`, `site`), `.nvmrc` = 22, `.editorconfig`, `rust-toolchain.toml`.
2. Scaffold `apps/desktop` bằng `pnpm create tauri-app` (Tauri 2, template Svelte + TS, pnpm; kiểm cờ bằng `--help`). `tauri.conf.json`: `productName` "Thaigit", `identifier` như trên, `version` "2.0.0", cửa sổ 1440×900 (min 1000×640), macOS `titleBarStyle: "Overlay"`; Windows giữ khung mặc định (xem lại ở 4a). Kiểm phiên bản Tauri có `WindowEffect::LiquidGlassRegular` (dùng ở 4a).
3. `packages/core` + `packages/contracts` rỗng + Vitest; `apps/desktop` import `@thaigit/core`. Tạo `packages/contracts/git-policy.json` bản đầu: env + cờ `-c` port **y nguyên** `GitEnvironment.swift:33-49` và `GitRunner.swift:67-78` (gồm `core.fsmonitor=false`), cộng phần mở rộng ở phase 2.
4. Icon: chạy `pnpm tauri icon` 2 lần ra thư mục tạm (`-o`): lấy `icon.icns` từ `brand/thaigit-icon-macos.png`, phần còn lại (`.ico`, PNG) từ `brand/thaigit-icon-square.png`; kiểm 16/32 px còn đọc được.
5. CI `ci.yml`: matrix {`macos-14`, `windows-latest`}: `pnpm install --frozen-lockfile` → lint → `pnpm -r test` → `cargo clippy` + `cargo test` → `tauri build --debug` (không ký). Action ghim theo SHA; `permissions: contents: read`; cache pnpm/cargo chỉ ở CI thường (release thì không). Thêm job `swift test` (macos) để app Swift không vỡ.
6. Thủ tục (song song, chỉ khi user đồng ý — câu hỏi mở 3): đăng ký Apple Developer; chọn CA cho chứng chỉ OV Windows có khoá trên HSM/dịch vụ ký đám mây (Azure Artifact Signing không nhận cá nhân ngoài Mỹ/Canada); giữ tên miền. Ngay: 2FA bằng khoá cứng cho GitHub, bảo vệ tag `v*`.
7. (Tuỳ chọn, ≈ 1 ngày) Vá 3 lỗi dữ liệu của app Swift đang dùng (red team FM2/FM8/AD9): `Diff.swift:127` tách dòng theo Character nên dòng CRLF không tách (tách theo byte `\n`); lưu conflict giải mã lossy làm mất byte/BOM (`GitRepository.swift:499-506` — ghi theo byte hoặc từ chối file không phải UTF-8); "Thêm vào .gitignore" ghi đè file không phải UTF-8 thành rỗng (`GitRepository.swift:333-336` — append theo byte). Phát hành bằng `./scripts/release.sh` khi user yêu cầu.

## Todo List
- [x] Repo GitHub public `HoangThai18/thaigit` tạo + push
- [x] App Swift đổi tên Thaigit (`com.phanthai.thaigit`, `build/Thaigit.app`), 48 test xanh
- [x] Logo chọn + icon nguồn (`brand/`, `scripts/make-icons.py`)
- [ ] pnpm workspace + scaffold Tauri chạy được trên macOS
- [ ] Chạy được trên Windows (máy thật/VM hoặc artifact CI)
- [ ] Bộ icon Tauri (`tauri icon`) cho cả 2 OS
- [ ] `packages/contracts` + `git-policy.json` bản đầu
- [ ] CI matrix xanh (kể cả job Swift)
- [ ] Thủ tục: Apple Developer, chứng chỉ Windows, tên miền; 2FA + bảo vệ tag
- [ ] (Tuỳ chọn) Vá 3 lỗi dữ liệu app Swift

## Success Criteria
- [ ] `pnpm tauri dev` mở cửa sổ "Thaigit" có icon mới trên macOS và Windows
- [ ] CI xanh trên cả 2 OS trong < 15 phút
- [x] App Swift build ra `build/Thaigit.app`, 48 test xanh

## Risk Assessment
- Logo chi tiết mảnh nhòe ở 16 px → dùng bản vuông đơn giản cho cỡ nhỏ (`.ico` nhiều cỡ).
- ToS Muse cho thương hiệu → giữ prompt + lịch sử làm bằng chứng nguồn gốc.
- Trùng tên "Thaigit" → kiểm npm/tên miền trước khi công bố landing.
- Identifier chốt sai → đổi sau khi có người dùng beta là mất thư mục dữ liệu; chốt trước M1b.
- Rollback: phase này chỉ thêm thư mục mới, app Swift không bị đụng (trừ bước 7 tuỳ chọn) → revert commit.

## Security Considerations
- Không commit secret; khoá ký chỉ trong Keychain máy chủ dự án (phase 8), không vào GitHub Secrets.
- CI: action ghim SHA, `--frozen-lockfile`, quyền `GITHUB_TOKEN` tối thiểu.

## Next Steps
- Phase 2a dùng workspace + `git-policy.json`.
