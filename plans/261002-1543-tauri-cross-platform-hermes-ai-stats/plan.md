---
title: "Thaigit: Tauri cross-platform client, Hermes AI commits, VPS stats"
description: "Viết lại Thaigit (app Swift macOS) bằng Tauri 2 cho Windows + macOS chung một code; AI viết commit bằng Hermes tự host trên VPS của chủ dự án; cập nhật qua GitHub Releases; server VPS chỉ lo AI proxy và thống kê có đồng ý."
status: pending
priority: P1
effort: "57-76 ngày công (+20-25% dự phòng ≈ 14-19 tuần)"
branch: "main"
tags: [feature, frontend, backend, api, infra, security]
blockedBy: []
blocks: []
created: "2026-10-02T08:49:09.562Z"
createdBy: "ck:plan"
source: skill
---

# Thaigit: Tauri cross-platform client, Hermes AI commits, VPS stats

## Overview

**Thaigit** hiện là app Swift chỉ chạy macOS (đã đổi tên, tự cập nhật qua GitHub Releases). Kế hoạch: viết lại thành **một code Tauri 2** cho Windows + macOS; thêm **AI viết commit / giải thích commit / mô tả PR** bằng **Hermes tự host trên VPS của chủ dự án** (người dùng không cần key, không bên thứ ba); server VPS chỉ lo **AI proxy** + **thống kê có đồng ý** + đếm lượt tải + landing. Cập nhật app đi thẳng qua GitHub Releases, không phụ thuộc VPS.

Phạm vi: **mở rộng** (user chọn 2026-10-02), giao theo mốc M1 → GA (dưới). Mục *(stretch)* / 1.x làm sau GA.

## Quyết định đã chốt (2026-10-02)

| Chủ đề | Quyết định |
|---|---|
| Nền tảng | Tauri 2 + Svelte 5 + TypeScript; Rust mỏng nhưng là **ranh giới bảo mật** (chạy git qua bộ kiểm tra, giữ env + cờ `-c`, file theo byte, watcher, askpass, updater) |
| Tên / logo | Thaigit; logo `brand/thaigit-logo-source.png` (Muse, mẫu 2, nhánh cam đỏ); icon nguồn từ `scripts/make-icons.py` (`brand/thaigit-icon-macos.png`, `brand/thaigit-icon-square.png`) |
| Giao diện | Ngôn ngữ kính như app Swift (Liquid Glass macOS 26), màu xanh `#2F86E8` + cam git `#F05032`; Tauri: hiệu ứng cửa sổ (Liquid Glass/vibrancy macOS, Mica Windows 11) + CSS `backdrop-filter`, có nền đặc khi tắt trong suốt |
| Repo | Public `github.com/HoangThai18/thaigit`; GitHub Releases chứa installer + manifest cập nhật |
| Cập nhật | Manifest tĩnh trên GitHub Releases: app Swift giữ `update.json` (Ed25519); app Tauri dùng `latest.json` (minisign) trên release kênh `desktop-beta`/`desktop-stable`; 2 khoá riêng, ký trên Mac chủ dự án |
| AI | Hermes **tự host trên VPS của chủ dự án** (OpenAI-compatible, SSE; env `HERMES_BASE_URL`, `HERMES_MODEL`, `HERMES_API_KEY` tuỳ chọn). App → API Thaigit → Hermes nội bộ; không bên thứ ba, không chi phí theo token; giới hạn theo **năng lực** (song song, hàng đợi, quota, trần token) |
| Server | VPS sẵn có: Node 22 + Hono + SQLite + Docker Compose + reverse proxy HTTPS; admin chỉ-đọc qua SSH tunnel |
| Ngôn ngữ | Chỉ tiếng Việt khi ra mắt; chuỗi gom trong `strings.vi.ts` để tách sau |
| App Swift | Đã đổi tên (`com.phanthai.thaigit`, `build/Thaigit.app`, 48 test xanh); chỉ sửa lỗi; ngừng sau GA |

## Kiến trúc & luồng dữ liệu

```
Thaigit desktop (Tauri 2)                                    GitHub Releases (public)
 Svelte 5 UI ── @thaigit/core (TS: parser, graph,             ├─ v2.x.y: installer, .app.tar.gz, SHA256SUMS(.sig)
   patch theo byte, conflict, AI context)                     └─ desktop-beta / desktop-stable: latest.json (minisign)
        │ invoke + Channel (frame byte có tag)                          ▲ (2) kiểm cập nhật, không gửi ID
 Rust: git_exec đã kiểm · RepoFs · khoá theo repo ·  ───────────────────┘
   watcher · askpass · updater (trước khi nạp UI)    ── (3)(4) HTTPS, chỉ sau đồng ý ──► VPS: Caddy/nginx (TLS) ─► API Hono + SQLite
        │ (1) spawn                                                                     ├─ /v1/ai/*  ─► Hermes (127.0.0.1 / mạng riêng)
 git CLI (Git for Windows / Apple / Homebrew)                                           ├─ /v1/telemetry/ping (opt-in)
                                                       (5) landing ─► /download/:asset ─┤  ─► 302 tới file trên GitHub
                                                                                        └─ /admin chỉ 127.0.0.1 (ssh -L)
```
1. **App ↔ git**: UI gửi yêu cầu có kiểu (`repoId`, subcommand trong allowlist, args đã kiểm) → Rust thêm env/cờ chuẩn, spawn → frame stdout/stderr/exit → core TS parse trong worker → UI.
2. **App ↔ GitHub**: Rust đọc `latest.json` của kênh (lúc mở + 6 giờ/lần) → kiểm minisign + chặn hạ cấp → cài khi hàng đợi git rỗng. Không gửi ID.
3. **App → AI** (chỉ sau đồng ý AI): diff đã lọc + quét bí mật + `aiInstallId` → hàng đợi năng lực → Hermes → SSE. Server không lưu nội dung.
4. **App → thống kê** (chỉ sau opt-in): `telemetryId` ngẫu nhiên + nền tảng + phiên bản, ≤ 1 lần/ngày.
5. **Người dùng → landing** → `/download/:asset` (đếm, không IP) → 302 GitHub.

Bố cục repo (pnpm workspace, cạnh app Swift): `apps/desktop` (Tauri) · `packages/core` (TS core + Vitest) · `packages/contracts` (hợp đồng API + `git-policy.json` dùng chung TS/Rust) · `server` (Hono) · `site` (landing) · Swift giữ nguyên ở gốc.

## Mốc giao hàng & đường cắt MVP

| Mốc | Gồm | Công (ngày) | Kết quả | Dự kiến* |
|---|---|---|---|---|
| M0 ✅ | App Swift Thaigit + tự cập nhật; repo public; logo | — | đã xong | 02/10/2026 |
| M1a Alpha xem | P1, P2a, P3, P4a | 21–27 | build nội bộ (artifact CI) chạy thật trên Windows + macOS: mở repo, graph, sidebar, chi tiết commit | 09–19/11/2026 |
| **M1b Beta đầu tiên = MVP** | P2b, P4b, P5a–5c, P8a | 17–23 | beta công khai (2.0.0, kênh `desktop-beta`), tự cập nhật; **không AI, không server** | 07–30/12/2026 |
| M2 AI | S1, P7a, P6 | 8–10 | beta có AI viết commit | 18/12/2026–15/01/2027 |
| M3 Thống kê & trang chủ | P7b, P8b | 4–6 | landing, đếm tải, DAU có đồng ý | 25/12/2026–27/01/2027 |
| GA | P5d, P9 + beta ≥ 7 ngày | 7–10 | bản chính thức | 13/01–26/02/2027 |

\*Tính từ 05/10/2026, 5 ngày/tuần, cộng 20% (sớm) – 25% (muộn) dự phòng; mốc muộn của GA đã gồm ~1 tuần nghỉ Tết (quanh 06/02/2027) và 7 ngày beta.

**Trong MVP (M1b):** mở/clone/tạo repo (mỗi repo một cửa sổ), graph + sidebar + chi tiết commit/stash, tìm commit, ⌘/Ctrl+B chuyển nhánh; stage/unstage/huỷ theo file, hunk, dòng (diff gộp); commit/amend + hoàn tác bền; fetch/pull/push (askpass, GCM), stash, nhánh/tag; merge/rebase/cherry-pick/revert/reset/push tag qua menu ngữ cảnh; banner thao tác dở + giải conflict; nhật ký lệnh (đã che token); cài đặt cơ bản; tự cập nhật; giao diện kính sáng/tối.
**Ngoài MVP:** diff tách đôi, diff ảnh, kéo-thả (5d, trước GA); AI (M2); thống kê, landing, đếm tải (M3); tab trong app, tiếng Anh, "Mở bằng…" nhiều app, panel lịch sử hoàn tác, BYOK (1.x).

**Thủ tục theo lịch (bắt đầu ở P1 nếu user đồng ý — câu hỏi mở 3; chạy song song):** Apple Developer (xác minh vài ngày–2 tuần; cần trước GA, beta dùng ký ad-hoc) · chứng chỉ OV Windows trên HSM/dịch vụ ký đám mây (thẩm định 1–3 tuần; cần trước GA; Azure Artifact Signing không nhận cá nhân ngoài Mỹ/Canada) · tên miền + DNS (trước M2) · cửa sổ beta ≥ 7 ngày (lịch, không phải công).

## Thứ tự & phụ thuộc

P1 → P2a → P3 → P4a **(M1a)** → P2b → P4b → P5a → P5b → P5c → P8a **(M1b)** → S1 → P7a → P6 **(M2)** → P7b → P8b **(M3)** → P5d → P9 → beta ≥ 7 ngày → **GA**.
Một người làm tuần tự. P7 chỉ đụng `server/**`, `docs/deploy-server.md` và thêm (không sửa phá) vào `packages/contracts` → chen được khi chờ việc khác (vd. chờ duyệt ký code); không phase song song nào cùng sửa một file.

## Ma trận kiểm thử

| Lớp | Công cụ | Phủ | Chạy |
|---|---|---|---|
| Unit TS | Vitest (`packages/core`, `packages/contracts`) | parser, patch theo byte, conflict, graph, context builder, quét bí mật, SSE, finalize | CI 2 OS mỗi PR |
| Tích hợp git thật | Vitest + adapter Node (`Exec` + `RepoFs`) | 39 test port từ Swift + ma trận CRLF/encoding + đường dẫn Windows | CI 2 OS mỗi PR |
| Rust | `cargo test` | validator lệnh/env, frame IPC, huỷ theo bậc, khoá theo commonDir, RepoFs phạm vi, watcher, comparator updater | CI 2 OS mỗi PR |
| E2E app thật | WebdriverIO + `@wdio/tauri-service` | kịch bản hồi quy Swift, IPC 50 MB băm khớp, XSS không tới `git_exec`, cập nhật | CI 2 OS (smoke mỗi PR, đủ mỗi mốc) |
| Server | Vitest `app.request` + Hermes giả | quota, hàng đợi/năng lực, IP sau proxy, không lưu nội dung, migration guard | CI |
| Thủ công | `docs/qa-checklist.md` | Windows thật + Mac | mỗi mốc |

## Tương thích ngược & rollback

- **App Swift không bị ảnh hưởng**: release Tauri tạo với `--latest=false`, manifest Tauri nằm trên release kênh → `releases/latest/download/update.json` vẫn của app Swift.
- **Dữ liệu**: bản Tauri dùng thư mục dữ liệu riêng theo identifier; không đọc/ghi UserDefaults của Swift; *(stretch)* nhập danh sách repo gần đây từ app Swift.
- **Chuyển người dùng Swift khi GA**: theo câu hỏi mở 4.
- **Rollback**: code chưa phát hành tới M1b → revert commit; bản phát hành lỗi → rút khỏi kênh + revert release (không hạ cấp); server → backup DB trước mỗi deploy + quay image trước; AI → kill switch.

## Câu hỏi mở (hỏi trong bước validate — không chặn P1–P2)

1. **VPS**: hệ điều hành gì, đang chạy nginx hay Caddy/Docker, tên miền cho Thaigit, máy đặt ở nước nào (ghi vào trang quyền riêng tư)? Cần trước M2.
2. **Hermes tự host**: chạy bằng gì (Ollama / vLLM / llama.cpp server), model + cỡ/lượng tử hoá nào, CPU hay GPU, cùng máy với API hay máy khác? Dùng để chốt timeout, số yêu cầu song song, trần token đầu vào và quota/ngày (spike S1 đo thật).
3. **Ký code**: đăng ký Apple Developer ($99/năm) và mua chứng chỉ OV Windows (khoá trên HSM/dịch vụ ký đám mây) ngay từ phase 1? Trong lúc chờ: macOS ký ad-hoc, Windows chưa ký.
4. **Định danh bản Tauri**: identifier riêng `com.phanthai.thaigit.desktop` (đề xuất — chạy song song app Swift không va chạm) hay dùng chung `com.phanthai.thaigit` (app Swift tự chuyển sang bản mới qua `update.json` khi GA)? Đánh số bản Tauri từ 2.0.0 (lớn hơn app Swift 1.x) — đồng ý?

## Research

- [Tauri desktop](./research/researcher-01-tauri-desktop-report.md) · [Hermes AI + backend](./research/researcher-02-hermes-ai-backend-report.md) · [Port inventory](./reports/scout-report.md) · 4 báo cáo red team trong `reports/`
- Mỗi báo cáo research/scout có khối **đính chính** ở đầu; khi mâu thuẫn, plan này là chuẩn (vd. `{{target}}` là `darwin`; Nous Portal/giá token không còn áp dụng vì Hermes tự host; diff viewer tự viết; askpass bằng chính binary app).

## Phases

| Phase | Name | Mốc | Status |
|-------|------|-----|--------|
| 1 | [Foundation & Branding](./phase-01-foundation-branding.md) | M1a | Done (repo, đổi tên, logo, workspace pnpm, Tauri chạy Windows + macOS, CI 2 OS xanh). Còn thủ tục: chứng chỉ ký mã Windows, Apple Developer |
| 2 | [Rust Backend Bridge](./phase-02-rust-backend-bridge.md) | 2a M1a · 2b M1b | Done (IPC, policy, trust, watcher, RepoFs, askpass bằng chính binary app; Rust test xanh CI 2 OS) |
| 3 | [TypeScript Core Port](./phase-03-typescript-core-port.md) | M1a | Done (core + adapter Tauri; 540+ test) |
| 4 | [UI Shell Graph & Sidebar](./phase-04-ui-shell-graph-sidebar.md) | 4a M1a · 4b M1b | Done trừ: đăng nhập GitHub trong app (chờ Client ID OAuth App — Windows dùng GCM), mỗi repo một cửa sổ (Ctrl+T), E2E WebdriverIO (thay bằng kiểm thử khói app thật trong CI) |
| 5 | [Staging Diff Conflicts & Drag-Drop](./phase-05-staging-diff-conflicts-drag-drop.md) | 5a–5c M1b · 5d GA | Done (staging theo dòng, conflict, menu; 5d: diff tách đôi, diff ảnh, kéo-thả pointer events) |
| 6 | [AI Commit Features (Hermes)](./phase-06-ai-commit-features-hermes.md) | M2 | Done phía app (viết commit, giải thích commit, mô tả PR, đồng ý + xem trước, lọc bí mật); chờ máy chủ chạy thật để đo TTFT |
| 7 | [VPS Server: AI Proxy & Stats](./phase-07-vps-server-ai-proxy-stats.md) | S1+7a M2 · 7b M3 | Code xong (`server/`, test với Hermes giả, chạy thật bằng Node); chờ dựng trên VPS + spike S1 với Hermes thật (`docs/deploy-server.md`) |
| 8 | [Release Pipeline, Updater & Landing](./phase-08-landing-page-release-pipeline.md) | 8a M1b · 8b M3 | Done (release-desktop.yml, minisign, kênh beta/stable, chế độ an toàn, trang chủ trên VPS, Cài đặt + thống kê có đồng ý). Chờ: ký số, trỏ nút tải qua `/download/*` khi máy chủ chạy |
| 9 | [Windows Hardening QA & Launch](./phase-09-windows-hardening-qa-launch.md) | GA | In progress (kiểm thử khói CI 2 OS, `docs/qa-windows-beta.md`, `docs/security-review-ai-stats.md`); còn chạy tay trên Windows thật + cửa sổ beta ≥ 7 ngày |

## Dependencies

- Không có plan khác đang mở.
- Bên ngoài: VPS + tên miền, Hermes tự host (đã có trên VPS), GitHub (Actions + Releases), Apple Developer + chứng chỉ OV Windows (trước GA).

## Red Team Review

### Phiên 2026-10-02 — 4 góc nhìn
SA = Security Adversary · SC = Scope & Complexity Critic · FM = Failure Mode Analyst · AD = Assumption Destroyer (báo cáo trong `reports/from-code-reviewer-to-planner-red-team-*.md`).
**40 phát hiện** (5 Critical, 24 High, 11 Medium): **20 Accept, 20 Accept (sửa), 0 Reject**; 12 đề xuất con không nhận (dưới). Sau đó user chốt **Hermes tự host** → các phát hiện về giá/nhà cung cấp AI được xử lý bằng quyết định này.

| # | Phát hiện | ID | Mức | Xử lý | Áp dụng |
|---|---|---|---|---|---|
| 1 | `git_exec` nhận args/env tuỳ ý → XSS hoặc gói npm độc thành RCE | SA1, AD6 | Critical | Accept | P2 (policy, validator, `repoId`), P4, P6, P9 |
| 2 | Không có mốc MVP; ước lượng là tổng thô, không dự phòng, thiếu lịch thủ tục | SC1, AD10 | Critical/Med | Accept | plan (mốc, lịch), P1, P9 |
| 3 | Hermes 4 "retired" trên Nous Portal, giá thật gấp 20–85 lần | AD1 | Critical | Accept (sửa): hết hiệu lực nhờ quyết định self-host; giữ cấu hình chung + health check model | P7, P6 |
| 4 | Bản lỗi tới mọi máy, không rút được; check cập nhật nằm trong UI | FM1 | Critical | Accept (sửa): kênh beta→stable, rút bản, revert release, check từ Rust + chế độ an toàn, smoke test bản cài | P8 |
| 5 | Ghi file mất byte/BOM, `.gitignore` bị xoá, giải mã lossy làm hỏng patch/conflict | FM2, AD9 | Critical/High | Accept | P2 (RepoFs), P3 (byte), P5, P1 (vá Swift tuỳ chọn) |
| 6 | Repo lạ chạy lệnh qua fsmonitor/filter/hook; sàn git có CVE RCE | SA2 | High | Accept (sửa): chỉ hỏi khi có khoá chạy lệnh/hook; cờ cứng luôn bật; sàn bảo mật | P2, P4b, P9 |
| 7 | Proxy AI dễ bị khai thác; trần $ thành công tắc của kẻ tấn công; IP lấy nhầm của proxy; nginx đệm SSE | SA3, FM6, AD4 | High | Accept (sửa): trần **năng lực** (self-host), IP qua proxy tin cậy, hàng đợi ưu tiên, cấu hình nginx | P7 |
| 8 | Đăng ký cài đặt trước khi đồng ý; một ID cho hai mục đích | SA4, AD3 | High | Accept: `aiInstallId` / `telemetryId` riêng, secret băm riêng | P6, P7, P8b |
| 9 | Lọc AI chỉ theo tên file; lời hứa "không lưu" sai với nhà cung cấp | SA5, AD2 | High | Accept (sửa): quét bí mật theo nội dung + xem trước; self-host → bỏ Privacy Mode, copy "không bên thứ ba" | P6, P8b |
| 10 | Khoá ký, Apple ID, khoá deploy dồn vào một job CI | SA6 | High | Accept (sửa): build không secret, ký trên Mac chủ dự án, khoá dự phòng, App Store Connect API key, khoá deploy `command=` | P1, P7, P8 |
| 11 | Manifest/installer không kiểm, có thể bị hạ cấp | SA7 | High | Accept (sửa): không còn manifest trong DB; SHA256SUMS ký; comparator chặn hạ cấp | P8 |
| 12 | Phase 4/5 quá lớn, tiêu chí "giống hệt Swift" | SC2 | High | Accept (sửa): lát 4a/4b, 5a–5d trong cùng file | P4, P5 |
| 13 | "Một interface Exec" sai: thiếu RepoFs, env lệch Swift, worker không có `invoke` | SC3, AD8 | High/Med | Accept (sửa): `git-policy.json` dùng chung, Rust thực thi; thư mục rác của app thay crate `trash` | P2, P3 |
| 14 | Askpass sidecar + `externalBin`/lipo chưa có trong CI | SC4 | High | Accept (sửa): chính binary app `--askpass`, làm ở 2b | P2 |
| 15 | Tab trong app kéo theo DnD tự viết | SC5 | High | Accept (sửa): mỗi repo một cửa sổ; DnD ở 5d sau spike | P4, P5 |
| 16 | Hai lớp UI test trên fixture ghi sẵn; ma trận QA quá lớn | SC6 | High | Accept: một lớp WebdriverIO 2 OS từ 4a; ma trận gọn | P4a, P5, P9 |
| 17 | Server mạ vàng; admin công khai, khoá tài khoản bị lợi dụng | SC7, SA8 | High/Med | Accept (sửa) / Accept: admin chỉ-đọc trên `127.0.0.1` + SSH tunnel, cấu hình chỉ env, một chế độ release | P7 |
| 18 | Hợp đồng API lệch giữa client/server/updater | SC8 | High | Accept: `packages/contracts`, mã lỗi, map platform, finalize ở client | P6, P7, P8 |
| 19 | IPC: bytes thành JSON, có thể cắt cụt | AD5 | High | Accept: frame Raw có tag, resolve ở `exit`, test 50 MB | P2, P3 |
| 20 | Huỷ/timeout giết thao tác ghi, kết quả bị che thành "đã huỷ" | FM3 | High | Accept: chỉ huỷ lệnh mạng, huỷ theo bậc, pull 2 bước, health/gỡ khoá | P2, P3, P5 |
| 21 | Hoàn tác là token 9 giây, có thể chạy nhầm nhánh | FM4 | High | Accept (sửa): nhật ký + ref + CAS; panel lịch sử → 1.x | P5 |
| 22 | Auto-fetch vượt hàng đợi; hàng đợi theo tab | FM5 | High | Accept: khoá theo `realpath(commonDir)` trong Rust, cửa sổ theo repo | P2, P4 |
| 23 | Beta macOS "bị hỏng" trên Apple Silicon; sidecar; target updater sai | AD7 | High | Accept: ký ad-hoc, binary askpass, map `darwin`/`windows` × `x86_64`/`aarch64` | P8, P2 |
| 24 | Rollback server với migration chỉ tiến | FM7 | Medium | Accept: backup trước deploy, migration chỉ thêm, `schema_version`, fail closed, xả SSE | P7 |
| 25 | Test CRLF không thể fail; Swift sai với CRLF | FM8 | Medium | Accept: ma trận byte-exact, tách theo byte `\n` | P3, P5, P1 |
| 26 | Watcher Windows dồn dập; mục tiêu 300 ms bất khả | FM9 | Medium | Accept: lọc gitignore, debounce thích nghi, mute, đo "sự kiện → bắt đầu làm mới" | P2, P4, P9 |
| 27 | GCM/env Windows khác Swift | FM10 | Medium | Accept (sửa): 2 hồ sơ env; ssh không tương tác bằng askpass từ chối (không đè `core.sshCommand`) | P2 |
| 28 | Hạ tầng i18n từ ngày đầu | SC9 | Medium | Accept: chỉ tiếng Việt, `strings.vi.ts` | P1, P4, P8b |
| 29 | Đổi tên app Swift; va chạm identifier với bản Tauri | SC10 | Medium | Accept (sửa): đổi tên giữ nguyên (đã làm); identifier Tauri riêng mặc định | P1, câu hỏi mở 4 |
| 30 | Tích hợp OS không chính sách; BatBadBut với `.cmd` | SA9 | Medium | Accept | P2 |
| 31 | Token askpass lọt xuống hook; nhật ký lệnh giữ credential | SA10 | Medium | Accept (sửa): token theo op; che log + cảnh báo, không viết lại URL remote | P2, P3, P5 |
| 32 | Scope audit của AD: git path hai nguồn, watcher/op mồ côi khi reload, múi giờ "ngày" quota | AD (bảng) | — | Accept | P2, P7 |

**Không nhận (đề xuất con):**
- Cho server ép hạ cấp qua `version_comparator` (FM1) → mâu thuẫn chống hạ cấp (SA7); dùng revert release.
- Rollout theo % băm installId (FM1) → cần ID + server động; dùng kênh beta + 7 ngày.
- Proof-of-work cho đăng ký (FM6) → YAGNI; đã có đồng ý trước đăng ký + rate IP + hàng đợi ưu tiên.
- Gom IPv4 theo /24 (SA3) → CGNAT ở VN gộp người vô can; gom theo địa chỉ, IPv6 /64.
- Reserve-then-reconcile ngân sách $ (SA3, FM6) → không còn chi phí token; thay bằng slot năng lực.
- File `.thaigitignore-ai` (SA5) → YAGNI; có xem trước payload + tắt AI theo repo.
- Duyệt pháp lý chuyển dữ liệu ra nước ngoài (SA5) → self-host; chỉ còn phụ thuộc vị trí VPS (câu hỏi mở 1).
- Xoay khoá updater lúc chạy để chống lộ khoá (SA6) → giới hạn cố hữu; chỉ nhúng khoá dự phòng (chống mất) + runbook.
- Tách userinfo khỏi URL clone, đưa qua askpass (SA10) → làm đổi cấu hình remote của user; chỉ che + cảnh báo.
- Env/cờ do runner TS sở hữu (SC3) → mâu thuẫn SA1; dùng file chính sách chung, Rust thực thi.
- Admin chỉ là bảng SQL, bỏ biểu đồ (SC7) → user muốn "trang quản trị kèm biểu đồ"; giữ vài biểu đồ chỉ-đọc sau SSH tunnel.
- Không đổi bundle id app Swift (SC10) → đã làm theo quyết định user.

### Whole-Plan Consistency Sweep
- Đọc lại: `plan.md`, `phase-01` … `phase-09` (phase 7 đổi tên file thành `phase-07-vps-server-ai-proxy-stats.md`; báo cáo red team vẫn trích tên file cũ `…-stats-updater.md` vì trỏ bản trước review); thêm khối đính chính vào 2 báo cáo research + scout report; sửa chú thích đầu `make-big-repo.py`.
- Delta đã kiểm (17): Hermes tự host + trần năng lực; cập nhật qua manifest tĩnh GitHub (bỏ `/v1/update`, `/v1/releases`, `/admin/api/releases`, `RELEASES_MODE`, `CI_RELEASE_TOKEN`); mốc M1a→GA + lát con; `aiInstallId`/`telemetryId`; `git-policy.json`; RepoFs; frame IPC; mỗi repo một cửa sổ; chỉ tiếng Việt; một lớp E2E WebdriverIO; askpass bằng binary app; 39 test port (Swift nay 48); identifier + đánh số 2.x; khoá ký + vị trí ký; chặn hạ cấp; trust gate + sàn bảo mật git; giao diện kính.
- Grep thuật ngữ cũ trong `plan.md` + `phase-*.md` (`Hermes-4-70B`, `api.nous.nousresearch.com`, Nous Portal làm nhà cung cấp, `/v1/update`, `X-Install-Id`, "Exec duy nhất", `macos` làm target updater, "40 test", `Nhánh.app`, timeout cho lệnh ghi, `$2/ngày`, Playwright/IPC giả, i18n vi/en, TabBar, sidecar `externalBin`): chỉ còn trong bảng red team, ghi chú này hoặc câu phủ định ("Không …").
- Tham chiếu cũ đã sửa: viết lại cả 9 phase + plan; 3 khối đính chính; 3 chỗ sửa thêm sau lượt quét ("Beta 0.1" → 2.0.0; ⌘T khi không còn tab; `/download` đọc manifest kênh beta trước GA) và bổ sung tên header AI ở phase 7.
- Mâu thuẫn chưa giải trong plan: 0. Ngoài phạm vi sửa: `README.md` (mục Quyền riêng tư) còn ghi AI "chuyển cho nhà cung cấp model" — cần sửa thành "Hermes chạy trên máy chủ Thaigit, không bên thứ ba" khi cập nhật README.
