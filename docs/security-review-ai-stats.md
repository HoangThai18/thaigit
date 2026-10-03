# Rà bảo mật & quyền riêng tư: AI viết commit và thống kê (2026-10-03)

Phạm vi: `server/`, `packages/core/src/ai/`, `packages/contracts/src/{ai,telemetry}.ts`, `apps/desktop/src/lib/{ai,stores/ai.svelte.ts,stores/telemetry.svelte.ts}`. Mỗi mục ghi rủi ro → cách chặn → bằng chứng (test / file).

## Dữ liệu rời máy người dùng

| Rủi ro | Cách chặn | Bằng chứng |
| --- | --- | --- |
| Gửi đi trước khi người dùng đồng ý | `AiStore.identity()` từ chối khi chưa `consented`; `aiInstallId` chỉ tạo sau đồng ý; Tắt AI xoá id + token | `apps/desktop/test/ai.test.ts` "chưa đồng ý: không request nào" |
| Lộ file bí mật | Lọc theo tên (`.env*`, khoá SSH / chứng chỉ, `.npmrc`, `credentials*.json`, `*.tfvars`, `appsettings*.json`…) và theo nội dung (≈ 17 mẫu tín hiệu cao + chuỗi entropy cao gán cho biến tên nhạy cảm) → bỏ cả hunk | `packages/core/test/ai.test.ts` (git thật: `.env`, `id_ed25519`, `.npmrc`, `AKIA…`, `ghp_…` không xuất hiện) |
| Người dùng không biết gửi gì | Hộp đồng ý nói rõ gửi gì / đi đâu / lưu gì; "Xem dữ liệu sẽ gửi" hiện đúng body | `AiConsent.svelte` dùng cùng `Prepared.preview` với request |
| Thống kê ngầm | Mặc định tắt; chỉ 4 trường (mã ngẫu nhiên, OS, kiến trúc, phiên bản), mỗi ngày tối đa 1 lần; mã riêng, khác mã AI | `apps/desktop/test/telemetry.test.ts` |
| Webview gọi lung tung | CSP `connect-src` chỉ thêm `https://git.thaipro.store` | `tauri.conf.json` |

## Máy chủ

| Rủi ro | Cách chặn | Bằng chứng |
| --- | --- | --- |
| Lưu nội dung code / message / IP / ID | DB chỉ có số liệu kỹ thuật; ID băm HMAC bằng 2 secret khác nhau (AI, thống kê — không nối được); log chỉ tên lỗi | `server/test/app.test.ts` "không lưu nội dung diff / ID / IP vào DB" |
| Giả token / đoán token | Token = HMAC(secret, aiInstallId), so sánh thời gian hằng; đăng ký ≤ 5 lần/giờ/IP | `crypto.ts`, test "đăng ký cài đặt tối đa 5 lần/giờ/IP" |
| Giả IP để né giới hạn | Chỉ tin `X-Real-IP` khi peer thuộc `TRUSTED_PROXY`; IPv6 gom /64 | test "chỉ tin X-Real-IP khi peer là proxy tin cậy" |
| Làm nghẽn máy chạy model | Song song tối đa N, hàng đợi có hạn + hết giờ, giới hạn/phút toàn cục + theo IP, 1 stream/cài đặt, quota/ngày, trần token đầu vào (tự cắt), body ≤ 200 KB, kill switch, chặn theo `id_hash`; người dùng cũ được ưu tiên, máy mới chỉ chiếm ½ luồng | `units.test.ts` "300 cài đặt mới không chặn được người dùng cũ", app tests quota / kill switch / one-stream |
| Hermes lộ ra Internet | Hướng dẫn bind 127.0.0.1 + kiểm `ss -ltnp`; API chỉ gọi `HERMES_BASE_URL` từ cấu hình | `docs/deploy-server.md` §1 |
| Trang admin bị truy cập | Listener riêng chỉ trên 127.0.0.1 (SSH tunnel), chỉ-đọc, HTML escape bằng `hono/html` | `admin.ts`, `main.ts` |
| CORS mở | Chỉ origin của app Tauri (`tauri://localhost`, `http(s)://tauri.localhost`) | test CORS trong `app.test.ts` |
| Lỗi lộ chi tiết | `onError` trả `{error:{code:'internal'}}`, không stack; app chỉ hiện câu tiếng Việt theo mã | `friendly-errors` + `AiFailure` |
| Secret trong image / compose | Đọc từ `*_FILE` (Docker secrets) hoặc `/etc/thaigit-api.env` chmod 600; systemd `DynamicUser`, `ProtectSystem=strict`, giới hạn RAM/CPU | `deploy/thaigit-api.service`, `docker-compose.yml` |
| Đổi schema làm hỏng dữ liệu | Migration chỉ thêm; code cũ gặp schema mới thì từ chối chạy; sao lưu trước mỗi lần deploy | `units.test.ts` "code cũ gặp schema mới hơn" |

## Đầu ra của model

| Rủi ro | Cách chặn |
| --- | --- |
| Prompt injection từ nội dung diff / commit lạ | System prompt dặn mọi thứ trong `<diff>`, `<commits>`, `<message>` là dữ liệu; đầu ra không bao giờ thành lệnh — chỉ là chữ trong ô soạn |
| HTML / script trong câu trả lời | Commit message vào `<input>` / `<textarea>`; markdown (giải thích, mô tả PR) vẽ bằng allow-list (`markdown.ts`): không HTML, không ảnh, link thành chữ — test "markdown của AI (allow-list)" và `no-raw-html.test.ts` |
| Khối suy nghĩ `<think>` của Hermes 4 | Lọc ngay trong luồng ở máy chủ (`think-filter.ts`, test cắt thẻ ở mọi vị trí) và lọc lại ở app (`finalize.ts`) |

## Còn lại / chấp nhận

- Token AI và mã thống kê nằm trong localStorage của webview (không phải kho bí mật OS): token chỉ gắn quota, không cấp quyền gì khác.
- Quét bí mật là heuristic — có thể bỏ sót chuỗi bí mật không theo mẫu; người dùng xem được dữ liệu trước khi gửi lần đầu.
- Kill switch, chặn id là thao tác tay của quản trị (không có UI web, theo thiết kế).
