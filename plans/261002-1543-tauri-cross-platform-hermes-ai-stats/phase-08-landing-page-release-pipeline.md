---
phase: 8
title: "Release Pipeline, Updater & Landing"
status: pending
priority: P1
effort: "5-7 ngày (8a: 3-4, 8b: 2-3; chờ duyệt ký code chạy song song)"
dependencies: [4, 5]
---

# Phase 8: Release Pipeline, Updater & Landing

## Overview
- **8a (M1b):** phát hành + tự cập nhật hoàn toàn qua **GitHub Releases** (manifest tĩnh, không cần server): build CI không secret, ký trên Mac của chủ dự án, kênh beta → stable, rút bản lỗi, kiểm cập nhật từ Rust trước khi nạp UI.
- **8b (M3, cần 7b):** landing tiếng Việt, trang quyền riêng tư, onboarding hỏi opt-in thống kê.

## Context Links
- Đã có cho app Swift: `scripts/release.sh`, `scripts/release-tool.swift`, `Sources/NhanhCore/Update/AppUpdate.swift` (kiểm size + SHA-256 + Ed25519, bundle id, phiên bản trong gói = manifest, swap nguyên khối `renamex_np`)
- [Tauri updater](https://v2.tauri.app/plugin/updater/) · [Ký macOS](https://v2.tauri.app/distribute/sign/macos/) · [Red team](./plan.md#red-team-review): FM1, SA6, SA7, AD7, SC4, SC8

## Key Insights
- App Swift tự cập nhật từ `releases/latest/download/update.json` mỗi 6 giờ. Bản Tauri **không được** chiếm "latest": release Tauri tạo với `--latest=false`; manifest Tauri nằm trên 2 release cố định đóng vai kênh, `desktop-beta` và `desktop-stable` (pre-release; asset `latest.json` ghi đè bằng `--clobber`). Endpoint: `https://github.com/HoangThai18/thaigit/releases/download/desktop-<kênh>/latest.json`.
- Hai định dạng, **hai khoá riêng** (không dùng chung khoá giữa 2 giao thức):

  | | App Swift (đang chạy) | App Tauri |
  |---|---|---|
  | Manifest | `update.json` (version, url, size, sha256, signature) | `latest.json` (version, notes, pub_date, platforms{url, signature}) |
  | Chữ ký | Ed25519 thô (base64) trên file zip | minisign (`tauri signer sign`) trên từng artifact |
  | Khoá bí mật | Keychain "Thaigit update signing key" / `THAIGIT_UPDATE_PRIVATE_KEY` | Keychain "Thaigit desktop updater key" + mục mật khẩu; truyền qua env chỉ cho tiến trình `tauri signer` |
  | Khoá công khai | Info.plist `ThaigitUpdatePublicKey` | `tauri.conf.json` `plugins.updater.pubkey` + pubkey dự phòng nhúng trong `updater.rs` (đổi khoá lúc chạy qua builder) |
  | Script | `scripts/release.sh` (giữ nguyên) | `scripts/release-desktop.mjs` |

  Sao lưu: mỗi khoá bí mật ở 2 nơi ngoại tuyến (trình quản lý mật khẩu + USB mã hoá); **không** đặt vào GitHub Secrets. Khoá dự phòng minisign chỉ nằm ngoại tuyến.
- Tauri gửi `{{target}}` ∈ `darwin|windows|linux`, `{{arch}}` ∈ `x86_64|aarch64|…` (không có "universal") → `latest.json` có `darwin-aarch64` và `darwin-x86_64` cùng trỏ bản universal `.app.tar.gz`, `windows-x86_64` trỏ NSIS `-setup.exe`. Không MSI.
- Mặc định Tauri cài khi `version > hiện tại`, nhưng version lấy từ manifest không ký → `version_comparator` tự viết: chỉ nhận khi version > hiện tại **và** khớp tên file trong trusted comment của chữ ký minisign; giữ "phiên bản cao nhất từng cài", từ chối thấp hơn. Không bao giờ hạ cấp: rút bản lỗi = **revert release** (build lại code cũ với số mới hơn).
- macOS chưa có Developer ID: ký ad-hoc `signingIdentity: "-"` (không ký thì Apple Silicon báo "bị hỏng"); lần đầu người dùng vẫn phải vào Cài đặt hệ thống → Quyền riêng tư & Bảo mật → "Vẫn mở". Windows chưa ký: SmartScreen "Thông tin thêm → Vẫn chạy". Ký thật (Developer ID + notarize; OV trên HSM) trước GA.
- Windows: bước cài làm app thoát → chỉ cài khi hàng đợi git rỗng (`on_before_exit` + khoá phase 2).

## Requirements
**8a**
- `release.yml` (tag `v2.*`): build Windows x64 NSIS trên CI **không secret** (action ghim SHA, `pnpm install --frozen-lockfile`, không khôi phục cache, `permissions: contents: read`); artifact + SHA-256 + attestation (`actions/attest-build-provenance`). Khi có chứng chỉ OV: job `sign-windows` riêng (environment có reviewer; chỉ ký Authenticode qua HSM/dịch vụ ký đám mây; không `pnpm install`) — spike tách build và bundle (`tauri build --no-bundle` + `tauri bundle`) [UNVERIFIED].
- `scripts/release-desktop.mjs <version> --channel beta|stable [--publish]` chạy **trên Mac của chủ dự án**: (1) build + ký macOS universal tại chỗ (ad-hoc, hoặc Developer ID + notarize bằng App Store Connect API key — không dùng Apple ID + mật khẩu ứng dụng); (2) tải artifact Windows (`gh run download`), kiểm SHA-256 + attestation; (3) `tauri signer sign` từng artifact; (4) sinh `latest.json` + `SHA256SUMS` (+ chữ ký minisign) + ghi chú từ `CHANGELOG.md`; (5) `gh release create v<version> --latest=false --prerelease` kèm file; (6) smoke test bản cài thật, đạt mới `gh release upload desktop-<kênh> latest.json --clobber`; giữ `latest-<version>.json` để quay lại.
- Smoke test trước khi lên kênh: cài installer thật trên runner sạch (Windows `/S`; macOS từ `.dmg`/`.app.tar.gz`), chạy `Thaigit --smoke` (khởi động, UI báo sẵn sàng, mở repo mẫu, thoát 0) + E2E smoke WebdriverIO.
- Kênh: lên beta trước; sau ≥ 7 ngày không lỗi nghiêm trọng → `--promote` cùng bản lên `desktop-stable`. Rút: `--yank <version>` ghi lại `latest.json` của kênh bằng bản trước; client đã ở bản lỗi nhận bản sửa qua revert release.
- App: `tauri-plugin-updater` gọi **từ Rust** lúc khởi động (trước khi nạp UI) và mỗi 6 giờ; request không kèm ID nào; kênh chọn trong Cài đặt (giai đoạn beta mặc định beta; sau GA mặc định stable). Toast "Có bản Thaigit x.y.z — Cập nhật & khởi động lại" (UI chỉ hiển thị, Rust làm). **Chế độ an toàn**: `boot.json` đếm lần khởi động hỏng liên tiếp (reset khi UI báo sẵn sàng); ≥ 3 → không khôi phục repo, kiểm + cài bản sửa ngay, báo bằng dialog native.
- Versioning: SemVer số thường từ `2.0.0`; `CHANGELOG.md` tiếng Việt là nguồn duy nhất cho ghi chú; script cập nhật version ở `package.json` + `tauri.conf.json` + `Cargo.toml` rồi tạo tag (chỉ khi user yêu cầu).

**8b**
- Landing (`site/`, Astro tĩnh; tiếng Việt + 1 đoạn tiếng Anh như README): hero + ảnh chụp, tính năng, nút tải theo OS (`/download/mac`, `/download/win`) + link dự phòng thẳng GitHub Releases, SHA-256 + pubkey minisign để tự kiểm, changelog (sinh lúc build từ `CHANGELOG.md`), FAQ (Gatekeeper/SmartScreen đúng trạng thái ký hiện tại), **Chính sách quyền riêng tư**: AI (gửi gì, chạy ở đâu — Hermes trên VPS của chủ dự án tại <vị trí>, không bên thứ ba, không lưu nội dung, số liệu kỹ thuật 30 ngày); thống kê (`telemetryId` ngẫu nhiên + nền tảng + phiên bản, 90 ngày, chỉ khi opt-in); cập nhật (chỉ tải từ GitHub, GitHub thấy IP như mọi lượt tải); liên hệ.
- Onboarding lần đầu: giao diện (sáng/tối/kính) + **hỏi rõ** "Gửi thống kê sử dụng ẩn danh?" với 2 nút ngang nhau (không chọn sẵn) + link chính sách. Đồng ý → tạo `telemetryId`, ping ≤ 1 lần/ngày; tắt trong Cài đặt → xoá ID, dừng ping.

**Non-functional:** landing Lighthouse ≥ 95; từ tag tới bản beta trên kênh < 60 phút; không manifest nào lên kênh nếu chữ ký chưa tự kiểm lại được bằng pubkey trong app.

## Architecture
```
git tag v2.0.3 ─► release.yml (Windows NSIS, không secret) ─► artifact + SHA-256 + attestation [─► sign-windows khi có OV]
Mac chủ dự án: release-desktop.mjs ─► build macOS universal (ad-hoc | Developer ID + notarize) ─► tải + kiểm artifact Windows
   ─► tauri signer sign ─► latest.json + SHA256SUMS ─► gh release create v2.0.3 --latest=false --prerelease
   ─► smoke test bản cài ─► desktop-beta/latest.json ─(≥ 7 ngày)─► desktop-stable/latest.json
App (Rust) ─► desktop-<kênh>/latest.json ─► comparator (> hiện tại, khớp trusted comment, ≥ max đã cài) ─► tải + kiểm minisign ─► cài khi hàng đợi rỗng
App Swift (không đổi) ─► releases/latest/download/update.json
Người dùng ─► landing ─► /download/<mac|win> (đếm, 7b) ─► 302 GitHub
```

## Related Code Files
- Create: `.github/workflows/release.yml`, `scripts/release-desktop.mjs`, `CHANGELOG.md`, `docs/release.md` (tạo/sao lưu/đổi khoá, runbook lộ khoá, rút bản), `apps/desktop/src-tauri/src/{updater.rs,safe_mode.rs}`, `site/**` (8b)
- Modify: `tauri.conf.json` (`plugins.updater.pubkey`, `endpoints`, `bundle.createUpdaterArtifacts`, macOS `minimumSystemVersion` 14.0, `signingIdentity` "-" khi chưa có Developer ID, NSIS, `webviewInstallMode`), `lib/shell/{Onboarding.svelte,UpdateToast.svelte}`, Settings (kênh cập nhật, quyền riêng tư)

## Implementation Steps
1. Sinh khoá minisign chính + dự phòng (`pnpm tauri signer generate`); khoá chính + mật khẩu vào Keychain; cả hai sao lưu 2 nơi ngoại tuyến; pubkey chính vào `tauri.conf.json`, pubkey dự phòng vào `updater.rs`. Viết `docs/release.md`.
2. `updater.rs` + `safe_mode.rs`: check từ Rust, comparator chặn hạ cấp, max-version, cài khi rảnh. Spike: Tauri có kiểm chữ ký trusted comment khi verify không — nếu không, kiểm phiên bản trong gói sau `download()` trước `install()` (như app Swift).
3. `release.yml` (Windows) + attestation.
4. `release-desktop.mjs` + test sinh `latest.json` (3 khoá platform, URL đúng tag `v<version>`).
5. Smoke test bản cài 2 OS; diễn tập: beta 2.0.0 → 2.0.1 tự cập nhật; rút 2.0.1 → kênh quay 2.0.0; client đang ở 2.0.1 nhận 2.0.2 (revert release).
6. (8b) Landing + privacy + FAQ + SHA256SUMS; onboarding + cài đặt quyền riêng tư; trỏ `/download/*` (7b).
7. Ký thật khi có chứng chỉ: notarize macOS; Authenticode Windows.

## Todo List
- [ ] (8a) Khoá minisign chính + dự phòng, sao lưu, runbook
- [ ] (8a) `updater.rs` (Rust, chặn hạ cấp, cài khi rảnh) + chế độ an toàn
- [ ] (8a) `release.yml` (Windows, không secret) + attestation
- [ ] (8a) `release-desktop.mjs` (macOS tại chỗ, ký, manifest, kênh, rút)
- [ ] (8a) Smoke test bản cài + diễn tập beta → stable → rút
- [ ] (8b) Landing + privacy + changelog + FAQ
- [ ] (8b) Onboarding opt-in thống kê + cài đặt
- [ ] Ký/notarize thật (khi có chứng chỉ)

## Success Criteria
- [ ] Đẩy tag → < 60 phút sau có bản beta trên kênh, đã qua smoke test cả 2 OS
- [ ] Bản 2.0.0 cài trên máy sạch tự cập nhật lên 2.0.1 (macOS arm64 + x86_64 qua universal, Windows x64)
- [ ] Manifest ghi version cao hơn nhưng trỏ artifact cũ (đã ký) → app từ chối
- [ ] Rút bản: kênh quay về bản trước trong < 10 phút; app Swift không bị ảnh hưởng (`releases/latest/download/update.json` vẫn là của app Swift)
- [ ] Bản lỗi làm UI không lên → chế độ an toàn vẫn tải được bản sửa
- [ ] (8b) Không opt-in thống kê → không có `telemetryId`, không ping (test + log server)
- [ ] (8b) Bấm "Tải cho Windows/macOS" → đúng file trên GitHub, dashboard tăng đếm

## Risk Assessment
- Không notarize → người dùng Mac bỏ cuộc lúc cài: FAQ có ảnh đúng trạng thái; mua Apple Developer trước GA.
- Mất khoá minisign → chuyển sang khoá dự phòng đã nhúng; lộ khoá → runbook (phát hành ký bằng khoá dự phòng, cảnh báo trên landing/README); giới hạn: kẻ giữ khoá cũ vẫn ký được tới khi người dùng lên bản đã bỏ khoá cũ.
- Build bị nhiễm (npm/action độc) → lockfile cố định, action ghim SHA, không cache ở release, attestation; ký tách khỏi build.
- Rollback: rút bản (kênh quay bản trước) + revert release; app Swift độc lập.

## Security Considerations
- Không secret trong job build; khoá updater chỉ trên Mac chủ dự án; job ký Windows chỉ có quyền ký (khoá không rời HSM).
- Updater luôn kiểm chữ ký + chặn hạ cấp, chỉ HTTPS; installer có SHA256SUMS ký minisign.
- GitHub: 2FA khoá cứng, bảo vệ tag `v*` và các release kênh.
- Trang privacy trung thực, khớp đúng những gì app và server thu thập.

## Next Steps
- Phase 9: kiểm thử, hiệu năng, cửa sổ beta, GA.
