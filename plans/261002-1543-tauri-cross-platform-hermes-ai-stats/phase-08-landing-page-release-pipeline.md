---
phase: 8
title: "Landing Page & Release Pipeline"
status: pending
priority: P1
effort: "4-6 ngày (+ thời gian chờ duyệt Apple Developer nếu đăng ký)"
dependencies: [4, 5, 7]
---

# Phase 8: Landing Page & Release Pipeline

## Overview
Đưa Thaigit tới người dùng:
- Landing page tiếng Việt/Anh có nút tải tự nhận diện hệ điều hành, trang chính sách quyền riêng tư và changelog.
- Pipeline CI build, ký và phát hành cho macOS + Windows.
- Tự cập nhật trong app qua server phase 7.
- Màn hình chào lần đầu, hỏi đồng ý gửi thống kê ẩn danh.

## Context Links
- [Tauri research §6 (ký code, updater)](./research/researcher-01-tauri-desktop-report.md)
- Phase 7: `/download/*`, `/v1/update/*`, `/admin/api/releases`

## Key Insights
- macOS: không notarize thì từ macOS 15 người dùng phải vào **Cài đặt → Quyền riêng tư & Bảo mật → "Vẫn mở"** mới chạy được. Muốn ai cũng cài dễ thì cần Apple Developer ($99/năm) để ký + notarize.
- Windows: chưa ký thì SmartScreen cảnh báo ("Thông tin thêm → Vẫn chạy"). Các lựa chọn ký (Azure Artifact Signing ≈ $10/tháng nếu tài khoản cá nhân ở VN đủ điều kiện, hoặc chứng chỉ OV) cần kiểm tra lại năm 2026 trước khi mua. Chứng chỉ EV **không còn** giúp vượt SmartScreen ngay.
- Tauri updater **bắt buộc** khoá ký riêng (minisign/Ed25519, miễn phí), tách biệt với ký code của OS. Mất khoá = không cập nhật được bản đã phát hành → phải sao lưu ngoại tuyến.
- macOS phát một bản **universal** (arm64 + x86_64) → trang tải chỉ cần 1 nút cho Mac.

## Requirements
- Functional
  - Landing (`site/`, Astro tĩnh, vi/en): hero kèm logo + ảnh chụp, tính năng (graph, kéo-thả, stage từng dòng, giải conflict, AI viết commit), nút tải theo OS (`/download/mac-universal`, `/download/win-x64`), các bản khác, changelog (từ `/v1/releases`), FAQ (Gatekeeper/SmartScreen nếu chưa ký), **Chính sách quyền riêng tư** (AI gửi gì, giữ bao lâu; thống kê ẩn danh; liên hệ), Điều khoản *(stretch)*.
  - Release CI (`release.yml`, chạy khi đẩy tag `v*`): matrix macOS universal (`.dmg` + `.app.tar.gz` + `.sig`) và Windows x64 (NSIS `.exe` + `.sig`; MSI tuỳ chọn); ký/notarize khi có secrets; tải lên GitHub Release (repo public) **hoặc** rsync lên VPS `releases/` (repo private); gọi `POST /admin/api/releases` với version, notes vi/en, URL + chữ ký từng nền tảng; smoke test `/download/*` và `/v1/update/*`.
  - Trong app: tauri-plugin-updater endpoint `https://<domain>/v1/update/{{target}}/{{arch}}/{{current_version}}`; kiểm khi mở app và mỗi 6 giờ; toast "Có bản Thaigit x.y.z — Cập nhật & khởi động lại"; header `X-Install-Id` chỉ gửi khi đã đồng ý thống kê.
  - Onboarding lần đầu: chọn ngôn ngữ, giao diện, **hỏi rõ** "Gửi thống kê sử dụng ẩn danh?" với 2 nút ngang nhau (không tick sẵn), kèm link chính sách. Đổi được trong Cài đặt.
  - Versioning: SemVer; `CHANGELOG.md` (vi/en); script `pnpm release x.y.z` cập nhật version ở `package.json` + `tauri.conf.json` + `Cargo.toml` rồi tạo tag (chỉ chạy khi user yêu cầu).
- Non-functional: landing Lighthouse ≥ 95; build release dưới 30 phút; chưa có chữ ký hợp lệ thì không bao giờ phát manifest updater.

## Architecture
```
git tag v0.1.0 ─► GitHub Actions release.yml
   ├─ macos-14: tauri build --target universal-apple-darwin  (+codesign/notarize nếu có APPLE_* secrets)
   ├─ windows-latest: tauri build (NSIS)                    (+ký nếu có secrets)
   ├─ ký updater bằng TAURI_SIGNING_PRIVATE_KEY (+PASSWORD)
   ├─ upload: GitHub Release (public) | rsync → VPS:/srv/thaigit/releases (private)
   └─ POST /admin/api/releases {version, notes, assets{darwin-universal|windows-x86_64: url, signature, size}}
App ─► GET /v1/update/... ─► 204 | 200 {url, signature} ─► tải + kiểm chữ ký ─► cài + khởi động lại
Người dùng ─► https://<domain>/ (site) ─► /download/<asset> (đếm) ─► file cài đặt
```

## Related Code Files
- Create: `site/**` (Astro, vi/en, trang privacy), `.github/workflows/release.yml`, `scripts/release.mjs`, `CHANGELOG.md`, `docs/release.md` (cách tạo/sao lưu khoá updater, secrets cần có)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, `endpoints`, `bundle.createUpdaterArtifacts`, macOS `minimumSystemVersion`, Windows `nsis` options, `webviewInstallMode`), `apps/desktop/src/lib/shell/{Onboarding.svelte,UpdateToast.svelte}`, Settings (quyền riêng tư)

## Implementation Steps
1. Sinh khoá updater (`pnpm tauri signer generate`), lưu private key + mật khẩu vào GitHub Secrets **và** một bản sao lưu ngoại tuyến (trình quản lý mật khẩu). Public key đưa vào `tauri.conf.json`.
2. `release.yml` không ký trước (bản beta), xuất artifact; thêm bước ký/notarize khi có secrets (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; Windows tuỳ phương án).
3. Đăng release lên server; kiểm tra updater từ một bản cũ → bản mới trên cả 2 OS.
4. Onboarding + toast cập nhật + cài đặt quyền riêng tư.
5. Landing Astro: trang chủ, tải về (nhận diện OS qua `navigator.userAgentData`/UA), changelog, privacy, FAQ; build ra `site/dist` → triển khai lên VPS (Caddy phục vụ `/`).
6. Bản beta v0.1.0 cho nhóm nhỏ dùng thử → sửa lỗi → v0.x tiếp theo.

## Todo List
- [ ] Khoá updater + sao lưu
- [ ] release.yml (chưa ký) chạy được
- [ ] Đăng release lên server + updater chạy 2 OS
- [ ] Onboarding đồng ý thống kê + toast cập nhật
- [ ] Landing vi/en + privacy + changelog
- [ ] Ký/notarize (theo quyết định ngân sách)
- [ ] Beta v0.1.0

## Success Criteria
- [ ] Đẩy tag → 30 phút sau có file cài đặt cho 2 OS và manifest trên server
- [ ] Bản 0.1.0 cài trên máy sạch tự cập nhật lên 0.1.1
- [ ] Bấm "Tải cho Windows/macOS" trên landing → tải đúng file, dashboard tăng đếm
- [ ] Không đồng ý thống kê → server không nhận `X-Install-Id` (kiểm log)

## Risk Assessment
- Không notarize → nhiều người dùng Mac bỏ cuộc lúc cài. Giảm thiểu: FAQ có ảnh hướng dẫn; ưu tiên mua Apple Developer trước khi công bố rộng.
- Mất/lộ khoá updater → không cập nhật được hoặc bị phát bản giả. Giảm thiểu: lưu 2 nơi, mật khẩu mạnh, chỉ CI dùng.
- Băng thông VPS nếu tự host file cài (khoảng 10–15 MB/lượt): 1.000 lượt khoảng 15 GB → đa số VPS dư sức; nếu tăng mạnh thì chuyển sang GitHub Releases/R2.

## Security Considerations
- Secrets chỉ trong GitHub Actions (environment `release` có reviewer bảo vệ); không in ra log.
- Updater luôn kiểm chữ ký; endpoint HTTPS bắt buộc.
- Trang privacy trung thực, khớp đúng những gì app và server thu thập.

## Next Steps
- Phase 9: kiểm thử Windows kỹ, đo hiệu năng, phát hành 1.0.
