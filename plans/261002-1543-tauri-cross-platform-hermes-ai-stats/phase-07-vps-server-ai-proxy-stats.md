---
phase: 7
title: "VPS Server: AI Proxy & Stats"
status: pending
priority: P1
effort: "6-8 ngày (S1: 0,5-1; 7a: 3-4; 7b: 2-3)"
dependencies: [1]
---

# Phase 7: VPS Server — AI proxy & thống kê

## Overview
Service nhỏ (Node 22 + Hono + SQLite) trên VPS sẵn có của chủ dự án. **Không** lo cập nhật app (manifest tĩnh trên GitHub Releases — phase 8a).
- **S1 (0,5–1 ngày, trước M2):** spike đo năng lực Hermes tự host.
- **7a (M2):** AI proxy tới Hermes nội bộ + giới hạn năng lực + deploy.
- **7b (M3):** ping thống kê (opt-in), đếm lượt tải, dashboard chỉ-đọc, retention.

Chỉ đụng `server/**`, `packages/contracts/**` (thêm, không sửa phá), `docs/deploy-server.md` → chen được khi chờ việc khác.

## Context Links
- [Research Hermes + backend](./research/researcher-02-hermes-ai-backend-report.md) (phần Nous Portal/giá/updater đã lỗi thời — xem đính chính đầu file)
- Phase 6 (client AI), phase 8 (manifest, landing) · [Red team](./plan.md#red-team-review): SA3/FM6/AD4, SA4/AD3, SA8, SC7, SC8, FM7, AD1

## Key Insights
- Hermes chạy trên VPS của chủ dự án (OpenAI-compatible `/v1/chat/completions`, SSE) → không tốn tiền theo token, không bên thứ ba. Giới hạn thật là **CPU/GPU/RAM**: lạm dụng làm nghẽn máy chứ không làm tốn tiền → không có trần $/ngày, thay bằng **trần năng lực**.
- Hermes cùng máy với API: Hermes chỉ bind `127.0.0.1` hoặc mạng nội bộ Docker, tường lửa chặn cổng của nó; chỉ API Thaigit ra Internet sau Caddy/nginx. Khác máy: mạng riêng (WireGuard) + `HERMES_API_KEY`.
- Ollama (và vài cấu hình llama.cpp) đặt context mặc định nhỏ và có thể cắt prompt mà không báo lỗi → đặt rõ context ≥ `AI_MAX_INPUT_TOKENS` + `max_tokens`; số luồng song song phía model khớp `AI_MAX_CONCURRENCY`.
- API sau proxy → địa chỉ socket là của proxy. IP thật chỉ lấy từ header do **proxy của mình** ghi đè; IPv6 gom /64; IPv4 theo từng địa chỉ (CGNAT phổ biến ở VN — không gom /24).
- Hai ID tách mục đích: `aiInstallId` (chỉ `/v1/ai/*`, sau đồng ý AI) và `telemetryId` (chỉ `/v1/telemetry/ping`, sau opt-in); băm HMAC bằng 2 secret khác nhau → không nối bảng được.
- Cấu hình chỉ ở env (một nguồn sự thật); không form cài đặt trên web.

## Requirements
| Method | Path | Lát | Mô tả |
|---|---|---|---|
| POST | `/v1/ai/install` | 7a | `{aiInstallId}` → `{token}` (HMAC). Chỉ gọi sau đồng ý AI. ≤ 5 lần/giờ/IP |
| GET | `/v1/ai/quota` | 7a | `{feature: {used, limit}, resetAt, maxInputTokens}` |
| POST | `/v1/ai/commit-message` | 7a | SSE: token → quota → hàng đợi → prompt (templates v1) → Hermes → chuyển tiếp `delta` |
| POST | `/v1/ai/explain-commit`, `/v1/ai/pr-description` | 7a *(mở rộng)* | SSE |
| GET | `/healthz` | 7a | `{api, db, ai: ok\|down}`; deploy chỉ xanh khi cả `ai: ok` |
| POST | `/v1/telemetry/ping` | 7b | `{telemetryId, platform: macos\|windows, arch, appVersion (semver)}`; ≤ 1 lần/ngày/ID |
| GET | `/download/:asset` | 7b | `mac` \| `win` → ghi 1 lượt (không IP) → 302 tới file trên GitHub |
| GET | `/admin` | 7b | Dashboard **chỉ-đọc**, listener riêng chỉ trên `127.0.0.1` (vào bằng `ssh -L`) |

- Hợp đồng chung `packages/contracts` (zod): body/response, frame SSE `queued{position}` / `delta` / `done{usage}` / `error{code}`; mã lỗi `invalid_token` 401, `quota_exhausted` 429, `ip_rate_limited` 429, `ai_busy` 503 + `Retry-After`, `ai_unavailable` 503, `ai_disabled` 503, `too_large` 413, `bad_request` 400; map `/download`: `mac` → `Thaigit_<v>_universal.dmg`, `win` → `Thaigit_<v>_x64-setup.exe`.
- Trần năng lực (env; mặc định chốt sau S1): `AI_MAX_CONCURRENCY` (generation song song), `AI_QUEUE_MAX` + `AI_QUEUE_TIMEOUT_S` (đầy/hết giờ → `ai_busy`), `AI_GLOBAL_RPM`, `AI_IP_RPM`, 1 stream/cài đặt, `AI_MAX_INPUT_TOKENS`, quota/ngày/cài đặt (`AI_QUOTA_COMMIT` 30, `AI_QUOTA_EXPLAIN` 20, `AI_QUOTA_PR` 10), body ≤ 200 KB, `HERMES_TIMEOUT_S`. "Ngày" = giờ Việt Nam (UTC+7).
- Ưu tiên khi nghẽn: hàng đợi ưu tiên cài đặt đã dùng thành công ở ≥ 2 ngày khác nhau; cài đặt mới chỉ chiếm tối đa ½ số slot → spam ID mới không chặn được người dùng cũ. Có danh sách chặn `id_hash`.
- Không tự thử lại upstream (gấp đôi tải). Lỗi DB ở bước quota → từ chối (fail closed).
- Non-functional: API (không tính model) thêm < 300 ms vào TTFT; container API giới hạn tài nguyên (vd. 0,5 CPU / 256 MB) để không tranh với model; không mất dữ liệu khi khởi động lại.

## Architecture
```
server/
├── src/app.ts (Hono) · env.ts (zod) · db.ts (better-sqlite3, WAL, migrations + schema_version) · client-ip.ts
├── src/routes/{install,quota,ai,telemetry,download,health}.ts
├── src/ai/{upstream.ts (OpenAI-compatible stream), admission.ts (semaphore + hàng đợi ưu tiên), prompts/v1/{commit,explain,pr}.ts}
├── src/limits/{quota.ts, rate.ts}
├── src/admin/ (listener 127.0.0.1; view Hono JSX, không HTML thô; static/chart.umd.js tự host)
├── test/*.test.ts · Dockerfile · docker-compose.yml · Caddyfile · nginx.conf.example · deploy.sh · .env.example
```
SQLite:
```sql
schema_meta(key TEXT PRIMARY KEY, value)                               -- schema_version
ai_installs(id_hash TEXT PRIMARY KEY, created_day, last_ok_day, ok_days) -- HMAC(AI_ID_SECRET, aiInstallId); không platform/version
ai_quota(day, id_hash, feature, count, PRIMARY KEY(day, id_hash, feature))       -- giữ 7 ngày
ai_requests(id INTEGER PRIMARY KEY, ts, day, feature, app_version, prompt_tokens, completion_tokens,
            queue_ms, ttft_ms, latency_ms, status, error_code)            -- KHÔNG id, KHÔNG nội dung; giữ 30 ngày
daily_active(day, tel_hash, platform, arch, app_version, PRIMARY KEY(day, tel_hash)) -- HMAC(TELEMETRY_ID_SECRET, telemetryId); 90 ngày
daily_counts(day, platform, app_version, dau)                             -- gộp hằng đêm, không ID, giữ lâu dài
downloads(id INTEGER PRIMARY KEY, ts, day, asset, version, ua_family)     -- không IP
```
Env: `HERMES_BASE_URL`, `HERMES_MODEL`, `HERMES_API_KEY` (tuỳ chọn), `HERMES_TIMEOUT_S`, `AI_*` (trên), `AI_KILL_SWITCH_FILE`, `AI_TOKEN_SECRET`, `AI_ID_SECRET`, `TELEMETRY_ID_SECRET`, `TRUSTED_PROXY` (IP/CIDR proxy), `PUBLIC_BASE_URL`, `DOWNLOAD_MANIFEST_URL` (kênh landing đang phát: `…/releases/download/desktop-beta/latest.json` trước GA, `desktop-stable` sau GA). Secret qua Docker secrets file.

## Related Code Files
- Create: `server/**`, `.github/workflows/server-deploy.yml`, `docs/deploy-server.md` (DNS, Docker, Caddy/nginx, bind Hermes, `.env`, backup/khôi phục, SSH tunnel cho admin), `reports/spike-hermes-capacity.md` (S1)
- Modify: `packages/contracts/src/{ai.ts,telemetry.ts,download.ts,errors.ts}`

## Implementation Steps
**S1 — spike (trước M2):** với Hermes thật của chủ dự án: xác nhận OpenAI-compatible + SSE (`stream: true`), id model, context tối đa, TTFT và token/s với diff 2k/6k token, số request song song chịu được, RAM/CPU khi chạy → chốt `AI_MAX_INPUT_TOKENS`, `AI_MAX_CONCURRENCY`, timeouts, quota, ngưỡng TTFT (phase 6). Ghi `reports/spike-hermes-capacity.md`.

**7a**
1. Khung Hono + env (zod) + SQLite WAL + migrations có `schema_version` (code cũ gặp schema mới → từ chối khởi động) + `/healthz`; Dockerfile multi-stage (`node:22-alpine`), user không root.
2. `client-ip.ts`: chỉ tin `X-Real-IP` (proxy ghi đè) khi peer ∈ `TRUSTED_PROXY`; IPv6 /64.
3. `/v1/ai/install` + token HMAC + middleware đọc `X-AI-Install-Id` + `X-AI-Token` (so constant-time) và `X-App-Version` (semver, ghi vào `ai_requests.app_version`).
4. Limits: quota/ngày (transaction), rate IP + toàn cục (bộ nhớ), `admission.ts` (semaphore, hàng đợi ưu tiên, timeout), kill switch (file tồn tại → `ai_disabled`, kiểm mỗi request).
5. AI proxy: validate body; prompt từ template (dặn bỏ qua chỉ dẫn trong diff); gọi `HERMES_BASE_URL/chat/completions` (`stream: true`, `temperature` 0.3, `max_tokens` theo tính năng); gửi `queued` khi chờ; chuyển tiếp `delta`; client ngắt → abort upstream + nhả slot; ghi `ai_requests` (usage cuối stream, không có thì ước lượng).
6. Health model lúc boot + mỗi 60 s (`GET /v1/models` hoặc completion 1 token): sai `HERMES_MODEL`/model ngừng → `ai: down`, AI trả `ai_unavailable`, phần còn lại vẫn chạy.
7. Deploy: compose (api + caddy, hoặc chỉ api nếu VPS đã có nginx). `deploy.sh` trên VPS: `sqlite3 .backup` → pull image → `up -d` → chờ `/healthz` (cả `ai: ok`) → hỏng thì quay image trước (migration chỉ thêm nên code cũ vẫn chạy). `stop_grace_period: 120s` + xả SSE khi SIGTERM. Khoá SSH deploy chỉ chạy được `deploy.sh` (`command=` trong `authorized_keys`). CI `server-deploy.yml`: test → build → push GHCR → gọi `deploy.sh`; action ghim SHA.
8. Proxy: Caddy (`reverse_proxy`, kiểm SSE flush) hoặc `nginx.conf.example` (`proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 300s`, API gửi `X-Accel-Buffering: no`, `proxy_set_header X-Real-IP $remote_addr`); tắt access log cho `/v1/*` (hoặc log không IP); giới hạn tốc độ `/v1/ai/install`.
9. Test: unit (quota, admission/hàng đợi ưu tiên, client-ip, HMAC, prompt), tích hợp `app.request` với Hermes giả (SSE chậm, lỗi, treo), test "không nội dung trong DB/log", TTFT qua proxy thật trên VPS, tải 50 rps (autocannon) → `ai_busy` đúng thay vì treo.

**7b**
10. `/v1/telemetry/ping`: validate enum/semver; dedupe (ngày, `tel_hash`); giới hạn số ID mới/ngày/IP; cảnh báo dung lượng đĩa.
11. `/download/:asset`: đọc `DOWNLOAD_MANIFEST_URL` (cache 5 phút) lấy phiên bản; chỉ 302 tới `https://github.com/HoangThai18/thaigit/releases/download/v<semver>/Thaigit_<semver>_(universal.dmg|x64-setup.exe)`; ghi lượt (asset, version, `ua_family` thô).
12. Admin chỉ-đọc: lượt tải/ngày theo nền tảng, DAU/WAU/MAU, phân bố phiên bản, AI request/ngày theo tính năng, token, hàng đợi/TTFT, tỉ lệ lỗi/bận.
13. Retention hằng đêm: `ai_quota` > 7 ngày, `ai_requests` > 30 ngày, `daily_active` > 90 ngày (sau khi gộp vào `daily_counts`); backup 14 bản (rclone ra ngoài thì mã hoá).

## Todo List
- [ ] (S1) Spike năng lực Hermes + chốt mặc định `AI_*`
- [ ] (7a) Khung server + DB (`schema_version`) + Docker
- [ ] (7a) IP sau proxy + install token + middleware
- [ ] (7a) Quota / rate / hàng đợi ưu tiên / kill switch
- [ ] (7a) AI proxy SSE + prompts v1 + health model
- [ ] (7a) Deploy (`deploy.sh`, backup trước deploy, proxy config) + CI + tài liệu
- [ ] (7b) Telemetry ping + download + admin chỉ-đọc
- [ ] (7b) Retention + backup

## Success Criteria
- [ ] (S1) Báo cáo năng lực có số đo thật; mặc định `AI_*` đã chốt
- [ ] `curl` (token hợp lệ) stream được message thật từ Hermes qua proxy; TTFT qua proxy đạt ngưỡng S1
- [ ] Quá quota → 429 `quota_exhausted`; hàng đợi đầy → 503 `ai_busy` + `Retry-After`; kill switch → 503 `ai_disabled` ngay; Hermes tắt → 503 `ai_unavailable` mà `/download` vẫn chạy
- [ ] 300 request từ 300 ID mới không làm request của cài đặt cũ bị từ chối (test hàng đợi ưu tiên)
- [ ] Rate limit theo IP thật; header giả từ peer không tin cậy bị bỏ qua (test)
- [ ] Không opt-in thống kê → không có dòng `daily_active`; DB và log không chứa nội dung diff/message (test)
- [ ] Deploy hỏng → tự quay bản trước, dữ liệu nguyên vẹn (diễn tập)
- [ ] Cổng Hermes không truy cập được từ Internet (quét cổng từ ngoài)

## Risk Assessment
- Lạm dụng (ID giả, script) làm nghẽn máy → quota + rate IP + hàng đợi ưu tiên + kill switch; nặng hơn: đăng nhập GitHub để có quota cao *(stretch)*.
- Model chiếm hết RAM/CPU → giới hạn song song, context, timeout; giới hạn tài nguyên container API; UptimeRobot + cảnh báo đĩa.
- VPS sập → app vẫn chạy, cập nhật không phụ thuộc VPS; chỉ AI và đếm tạm ngừng (landing có link tải thẳng GitHub).
- Migration hỏng → backup trước deploy, migration chỉ thêm, `schema_version` chặn code cũ.
- Rollback: `deploy.sh` quay image trước; tệ nhất khôi phục `.backup` ngay trước deploy (chỉ mất số đếm sau thời điểm đó).

## Security Considerations
- Validate mọi input bằng zod; giới hạn body; timeout; không trả stack trace.
- Không log body AI, chỉ metadata; HSTS, `X-Content-Type-Options`; admin không ra Internet (không cần đăng nhập web, CSRF, khoá tài khoản).
- Secret (`AI_*_SECRET`, `TELEMETRY_ID_SECRET`, `HERMES_API_KEY`) qua Docker secrets file (chmod 600), không nằm trong compose env/image.
- SQLite + backup quyền 600; backup ra ngoài thì mã hoá.
- Luật Bảo vệ dữ liệu cá nhân / Nghị định 13: thống kê chỉ khi opt-in; AI chỉ sau đồng ý; trang chính sách ghi rõ vị trí VPS (phase 8b).

## Next Steps
- Phase 6 nối client vào `/v1/ai/*`; phase 8b trỏ landing tới `/download/*` và onboarding tới `/v1/telemetry/ping`.
