---
phase: 7
title: "VPS Server AI Proxy Stats Updater"
status: pending
priority: P1
effort: "5-7 ngày"
dependencies: [1]
---

# Phase 7: VPS Server — AI proxy, thống kê, cập nhật

## Overview
Một service nhỏ trên VPS của user (Node 22 + Hono + SQLite) gánh 5 việc:
1. Proxy AI tới Hermes (Nous Portal), có giới hạn lượt và trần chi phí.
2. Đếm lượt tải, sau đó chuyển hướng tới file cài đặt.
3. Trả manifest cập nhật cho Tauri updater, đồng thời đếm người dùng hoạt động (ẩn danh, có đồng ý).
4. Trang quản trị có biểu đồ.
5. Phục vụ landing page (file tĩnh của phase 8).

Làm song song được với phase 3–5.

## Context Links
- [Hermes AI + backend research](./research/researcher-02-hermes-ai-backend-report.md)
- [Tauri updater (dynamic endpoint)](https://v2.tauri.app/plugin/updater/)

## Key Insights
- Giá theo research (cần kiểm lại khi làm): Hermes-4-70B khoảng $0,05/1M token vào và $0,20/1M token ra. Một lần viết commit khoảng 4k token vào + 150 ra, tức khoảng **$0,0002**. 1.000 lượt/ngày chỉ tốn khoảng $0,2/ngày → nạp credit trả theo dùng là đủ, **không cần gói thuê bao $200/tháng** như research đề xuất.
- Không lưu installId thô: lưu `id_hash = HMAC(ID_HASH_SECRET, installId)` (bút danh hoá).
- Đếm người dùng hoạt động bằng chính lần app kiểm tra cập nhật (gửi `X-Install-Id` chỉ khi người dùng đã đồng ý) → không cần thêm telemetry riêng.
- Nếu repo GitHub private thì link Release cần đăng nhập → file cài đặt phải nằm trên VPS (`/releases/`, Caddy phục vụ). Repo public thì 302 sang GitHub Releases (tiết kiệm băng thông).

## Requirements
- Functional — endpoints

| Method | Path | Mô tả |
|---|---|---|
| POST | `/v1/install` | `{installId, platform, appVersion}` → `{token}` (HMAC). Idempotent. Giới hạn 10 lần/giờ/IP |
| GET | `/v1/ai/quota` | Lượt đã dùng / giới hạn / giờ reset |
| POST | `/v1/ai/commit-message` | SSE. Kiểm tra token → quota → trần ngân sách → dựng prompt (templates v1) → gọi upstream stream → chuyển tiếp delta |
| POST | `/v1/ai/explain-commit` | SSE *(mở rộng)* |
| POST | `/v1/ai/pr-description` | SSE *(mở rộng)* |
| GET | `/download/:asset` | `mac-universal`, `win-x64`, `win-x64-msi` (tuỳ chọn `?v=`) → ghi 1 lượt → 302 hoặc trả file |
| GET | `/v1/update/:target/:arch/:currentVersion` | 204 nếu đã mới nhất, ngược lại 200 `{version, notes, pub_date, url, signature}`. Có `X-Install-Id` thì ghi hoạt động trong ngày |
| GET | `/v1/releases` | Danh sách bản phát hành (cho trang changelog) |
| GET/POST | `/admin/*` | Đăng nhập, dashboard, cài đặt (tắt AI, trần $/ngày, quota, model), API cho CI đăng release |
| GET | `/healthz` | Kiểm tra sống |

- Mặc định (chỉnh trong admin): commit 30 lượt/ngày/cài đặt; explain 20; PR 10; 30 request/phút/IP; trần **$2/ngày** toàn hệ thống (chạm trần → 503 có thông điệp); body tối đa 200 KB; tối đa 16k token đầu vào (server tự cắt thêm).
- Non-functional: p95 thời gian tới chữ đầu tiên (không tính model) dưới 300 ms; chạy ổn trên VPS 1 vCPU / 1 GB; không mất dữ liệu khi khởi động lại.

## Architecture
```
server/
├── src/app.ts (Hono) · env.ts (zod) · db.ts (better-sqlite3, WAL, migrations)
├── src/routes/{install,ai,download,update,releases,admin,health}.ts
├── src/ai/{upstream.ts (OpenAI-compatible stream client), prompts/v1/{commit,explain,pr}.ts, postprocess.ts, cost.ts}
├── src/limits/{quota.ts, ipRate.ts, budget.ts}
├── src/admin/{auth.ts (argon2id + session cookie + CSRF), views/*.tsx (Hono JSX), static/chart.umd.js}
├── test/*.test.ts
├── Dockerfile · docker-compose.yml · Caddyfile (hoặc nginx.conf.example) · .env.example
```
SQLite schema:
```sql
installs(id_hash TEXT PRIMARY KEY, created_at, last_seen_at, platform, app_version)
daily_active(day TEXT, id_hash TEXT, platform, app_version, PRIMARY KEY(day, id_hash))
downloads(id INTEGER PRIMARY KEY, ts, day, asset, version, ua_family, referrer_host)
ai_requests(id INTEGER PRIMARY KEY, ts, day, id_hash, feature, model, prompt_tokens, completion_tokens,
            cost_usd_micros, status, latency_ms, error_code)        -- KHÔNG có nội dung diff/message
ai_quota(day, id_hash, feature, count, PRIMARY KEY(day, id_hash, feature))
releases(version TEXT PRIMARY KEY, pub_date, notes_vi, notes_en, channel, assets_json)
settings(key TEXT PRIMARY KEY, value)   -- ai_enabled, daily_budget_usd, quotas, model
```
Biến môi trường: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (vd. Hermes-4-70B), `AI_MODEL_FALLBACK`, `INSTALL_HMAC_SECRET`, `ID_HASH_SECRET`, `ADMIN_PASSWORD_HASH`, `CI_RELEASE_TOKEN`, `PUBLIC_BASE_URL`, `RELEASES_MODE=github|local`.

## Related Code Files
- Create: toàn bộ `server/**` như trên; `.github/workflows/server-deploy.yml`
- Create: `docs/deploy-server.md` (hướng dẫn VPS: DNS, Docker, Caddy/nginx, `.env`, backup, khôi phục)

## Implementation Steps
1. Khung Hono + env (zod) + SQLite + migrations + `/healthz`; Dockerfile multi-stage (node:22-alpine), user không phải root.
2. `/v1/install` + HMAC token + middleware xác thực (`X-Install-Id`, `X-Install-Token`, so sánh constant-time).
3. Limits: quota/ngày (transaction SQLite), rate theo IP (bộ nhớ, cửa sổ trượt), budget (tổng `cost_usd_micros` hôm nay so với trần), công tắc tắt AI.
4. AI proxy: validate body; dựng prompt từ template; gọi `AI_BASE_URL/chat/completions` với `stream: true`, `temperature 0.3`, `max_tokens` theo tính năng, timeout 60 s; chuyển tiếp SSE; khi client ngắt thì abort upstream; ghi usage (lấy `usage` cuối stream nếu có, không thì ước lượng). Hậu xử lý: bỏ code fence, dòng đầu ≤ 72 ký tự. Upstream lỗi → thử model dự phòng 1 lần.
5. Download + update + releases: logic chọn asset theo `target/arch`; 204/200 đúng chuẩn Tauri v2; `ua_family` thô (macOS/Windows/khác), không lưu IP.
6. Admin: đăng nhập (argon2id, khoá 15 phút sau 5 lần sai), cookie `HttpOnly; Secure; SameSite=Strict`, CSRF. Dashboard Chart.js (file tĩnh tự host): lượt tải/ngày theo nền tảng, cộng dồn; DAU/WAU/MAU; phân bố phiên bản; AI request/ngày theo tính năng; token & chi phí/ngày so với trần; tỉ lệ lỗi. Form cài đặt. API `POST /admin/api/releases` cho CI (Bearer `CI_RELEASE_TOKEN`).
7. Retention: job hằng ngày xoá `ai_requests` > 90 ngày, `daily_active` > 400 ngày (giữ số tổng hợp theo tháng).
8. Deploy: docker compose (api + caddy, hoặc chỉ api nếu VPS đã có nginx); volume `data/` (SQLite) và `releases/`; backup hằng đêm bằng `sqlite3 .backup` giữ 14 bản (tuỳ chọn rclone ra ngoài); xoay log docker.
9. CI `server-deploy.yml`: test → build image → push GHCR → SSH vào VPS `docker compose pull && up -d` → kiểm `/healthz`; rollback bằng tag trước.
10. Test: unit (quota, budget, HMAC, chọn asset updater, postprocess), tích hợp `app.request` với upstream giả (SSE), tải thử 50 rps (autocannon).

## Todo List
- [ ] Khung server + DB + Docker
- [ ] Install token + middleware
- [ ] Quota / IP rate / budget / kill switch
- [ ] AI proxy SSE + prompts v1 + fallback
- [ ] Download + updater + releases
- [ ] Admin + biểu đồ + cài đặt
- [ ] Retention + backup
- [ ] Deploy lên VPS + CI + tài liệu

## Success Criteria
- [ ] `curl` tới `/v1/ai/commit-message` (token hợp lệ) stream được message thật từ Hermes
- [ ] Vượt quota → 429; chạm trần → 503; tắt AI trong admin → 503 ngay
- [ ] `/download/win-x64` tăng bộ đếm và tải đúng file; updater trả 204/200 đúng chuẩn và app cập nhật được
- [ ] Dashboard hiện số liệu đúng với dữ liệu giả lập; backup khôi phục thử thành công
- [ ] Log và DB không chứa nội dung diff/message (test kiểm)

## Risk Assessment
- Lạm dụng (giả UUID, script spam): chặn bằng trần $/ngày (giới hạn cứng), rate theo IP, giới hạn đăng ký install/IP. Nặng hơn thì thêm đăng nhập GitHub để được quota cao *(stretch)*.
- Key Hermes lộ: chỉ nằm trong `.env` trên VPS (chmod 600), không bao giờ gửi về client; xoay key định kỳ.
- VPS sập → app vẫn chạy bình thường (AI và update báo lỗi nhẹ). Theo dõi bằng UptimeRobot.
- Giá/endpoint Nous Portal thay đổi → cấu hình qua env, có model dự phòng; trần chi phí tính từ bảng giá trong env.

## Security Considerations
- Mọi input validate bằng zod; giới hạn body; timeout; không trả stack trace.
- Không log body request AI; chỉ metadata. Header bảo mật (HSTS qua Caddy, `X-Content-Type-Options`, CSP cho admin).
- Admin: argon2id, khoá khi sai nhiều, CSRF, tuỳ chọn chỉ cho IP của bạn.
- SQLite file quyền 600; backup cũng mã hoá nếu đưa ra ngoài.
- Tuân thủ Luật Bảo vệ dữ liệu cá nhân của Việt Nam (hiệu lực 2026) / Nghị định 13: thống kê chỉ gửi khi người dùng đồng ý; có trang chính sách (phase 8).

## Next Steps
- Phase 6 nối client vào `/v1/ai/*`; Phase 8 đăng release và trỏ landing/updater tới server.
