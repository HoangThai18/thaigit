---
title: "Thaigit: Tauri cross-platform client, Hermes AI commits, VPS stats"
description: "Viết lại Nhánh thành Thaigit bằng Tauri 2 (Windows + macOS chung một code), thêm AI viết commit bằng Hermes qua server proxy, và server trên VPS để đếm lượt tải, người dùng, phát cập nhật."
status: pending
priority: P1
branch: "main"
tags: [feature, frontend, backend, api, infra]
blockedBy: []
blocks: []
created: "2026-10-02T08:49:09.562Z"
createdBy: "ck:plan"
source: skill
---

# Thaigit: Tauri cross-platform client, Hermes AI commits, VPS stats

## Overview

Đổi tên sản phẩm thành **Thaigit**. Viết lại app Git kiểu GitKraken (hiện là app Swift "Nhánh", chỉ chạy macOS) thành **một code Tauri 2** cho cả Windows và macOS. Thêm **AI viết commit / giải thích commit / mô tả PR** bằng model Hermes (Nous Research) qua server proxy của chủ app (người dùng không cần key). Dựng **server trên VPS** để: đếm lượt tải, đếm người dùng hoạt động (ẩn danh, có đồng ý), phát bản cập nhật tự động, có landing page và trang quản trị kèm biểu đồ.

Phạm vi: **mở rộng** (user chọn 2026-10-02). Các mục đánh dấu *(stretch)* là làm sau khi phần chính chạy ổn.

## Quyết định đã chốt (2026-10-02)

| Chủ đề | Quyết định |
|---|---|
| Nền tảng | Tauri 2 + Svelte 5 + TypeScript; Rust chỉ làm phần mỏng (chạy git, theo dõi file, askpass, updater) |
| Tên / icon | Thaigit; logo tạo bằng Muse (muse.ai), chọn 1 mẫu rồi sinh bộ icon bằng `tauri icon` |
| AI | Server proxy giữ key Hermes; app gọi server, có giới hạn lượt/ngày và trần chi phí/ngày |
| Server | VPS sẵn có của user: Node 22 + Hono + SQLite + Docker Compose + reverse proxy HTTPS |
| App Swift cũ | Đổi tên Thaigit, chỉ sửa lỗi; ngừng khi bản Tauri đủ tính năng |

## Kiến trúc tổng quát

```
┌──────────── Thaigit desktop (Tauri 2) ────────────┐        ┌──────────── VPS ─────────────┐
│ Svelte 5 UI ── packages/core (TS: parser, graph,  │ HTTPS  │ Caddy/nginx (TLS)            │
│   patch, conflict, AI context builder)            │ ─────► │  ├─ /            landing      │
│        │ invoke/Channel                           │        │  ├─ /download/*  đếm + 302    │
│ Rust: git exec (stream, cancel, no-window),       │        │  ├─ /v1/update/* Tauri updater│
│   watcher (notify), askpass sidecar, updater      │        │  ├─ /v1/ai/*     proxy SSE ──►│── Nous Portal (Hermes 4)
│        │ spawn                                    │        │  └─ /admin       biểu đồ      │
│      git CLI (Git for Windows / Apple git)        │        │ Hono + SQLite (WAL)          │
└───────────────────────────────────────────────────┘        └──────────────────────────────┘
```

Bố cục repo (pnpm workspace, cùng thư mục với app Swift hiện tại):
`apps/desktop` (Tauri) · `packages/core` (TS core + Vitest) · `server` (Hono) · `site` (landing) · Swift giữ nguyên ở gốc.

## Thứ tự & song song

1 → 2 → 3 → 4 → 5 → 9 là đường chính. Phase 7 (server) làm song song từ sau phase 1. Phase 6 cần 3 + 5 + 7 (phía client làm trước với server giả). Phase 8 cần 4, 5, 7.
Ước lượng: khoảng 10–13 tuần cho 1 người (có AI hỗ trợ).

## Câu hỏi còn mở (hỏi trong bước validate)

1. VPS: hệ điều hành? đã chạy nginx/Caddy/Docker chưa? tên miền cho Thaigit?
2. Hermes: dùng Nous Portal API (đã có tài khoản/key?) hay Hermes Agent tự host? Model mặc định (Hermes-4-70B)?
3. Ngân sách AI: trần chi phí/ngày, số lượt mỗi người/ngày?
4. Ký code: mua Apple Developer ($99/năm)? Ký cho Windows (Azure Artifact Signing / OV) hay chưa ký lúc beta?
5. Repo GitHub public (mã nguồn mở) hay private? Nếu private thì file cài đặt đặt trên VPS.
6. Bundle id `com.phanthai.thaigit` có được không?

## Research

- [Tauri desktop](./research/researcher-01-tauri-desktop-report.md) · [Hermes AI + backend](./research/researcher-02-hermes-ai-backend-report.md) · [Port inventory](./reports/scout-report.md)
- Đã sửa lại so với báo cáo: Hermes 4 70B có context 128k (không phải 4k); giá theo token rất thấp nên không cần gói thuê bao lớn; diff viewer tự viết (không dùng CodeMirror merge vì nó tự tính diff, lệch với hunk của git khi stage từng dòng); chứng chỉ EV không còn giúp qua SmartScreen ngay (kiểm tra lại trước khi mua).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation & Branding](./phase-01-foundation-branding.md) | Pending |
| 2 | [Rust Backend Bridge](./phase-02-rust-backend-bridge.md) | Pending |
| 3 | [TypeScript Core Port](./phase-03-typescript-core-port.md) | Pending |
| 4 | [UI Shell Graph & Sidebar](./phase-04-ui-shell-graph-sidebar.md) | Pending |
| 5 | [Staging Diff Conflicts & Drag-Drop](./phase-05-staging-diff-conflicts-drag-drop.md) | Pending |
| 6 | [AI Commit Features (Hermes)](./phase-06-ai-commit-features-hermes.md) | Pending |
| 7 | [VPS Server AI Proxy Stats Updater](./phase-07-vps-server-ai-proxy-stats-updater.md) | Pending |
| 8 | [Landing Page & Release Pipeline](./phase-08-landing-page-release-pipeline.md) | Pending |
| 9 | [Windows Hardening QA & Launch](./phase-09-windows-hardening-qa-launch.md) | Pending |

## Dependencies

- Không có plan khác đang mở (đã quét `./plans/` và `~/.claude/plans/`).
- Bên ngoài: tài khoản Nous Portal (key Hermes), VPS + tên miền, tài khoản GitHub (Actions + Releases), Apple Developer (nếu notarize), logo từ Muse.
