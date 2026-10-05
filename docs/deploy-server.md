# Máy chủ Thaigit trên VPS (AI viết commit + thống kê)

`server/` là một dịch vụ nhỏ (Node 24 + Hono + SQLite có sẵn trong Node) chạy cạnh trang chủ trên VPS:

| Đường dẫn | Việc |
| --- | --- |
| `POST /v1/ai/install`, `GET /v1/ai/quota` | đăng ký máy (chỉ sau khi người dùng đồng ý dùng AI), xem lượt còn lại |
| `POST /v1/ai/commit-message` · `/v1/ai/explain-commit` · `/v1/ai/pr-description` | chuyển ngữ cảnh đã lọc cho **Hermes trên chính VPS**, stream chữ về app (SSE) |
| `POST /v1/telemetry/ping` | thống kê ẩn danh — chỉ máy nào bật trong Cài đặt |
| `GET /download/mac`, `/download/win` | đếm một lượt tải (không IP) rồi chuyển tới file trên GitHub Releases |
| `GET /v1/stats/downloads` | `{total, mac, win}` — tổng lượt tải công khai (bỏ bot / curl) cho bộ đếm trên trang chủ |
| `GET /healthz` | `{api, db, ai}` |
| `http://127.0.0.1:8788/` | trang admin **chỉ-đọc**, không ra Internet |

App gọi API ở `https://git.thaipro.store` (cùng tên miền với trang chủ). Cập nhật app **không** phụ thuộc máy chủ này: VPS tắt thì chỉ AI và số đếm tạm ngừng.

Không lưu nội dung: DB chỉ có số liệu kỹ thuật (số token, thời gian, mã lỗi), ID đã băm HMAC, không IP.

## 1. Hermes (model)

Bất kỳ máy chủ nói chuẩn OpenAI (`/v1/chat/completions` có stream) đều được: Ollama, llama.cpp server, vLLM… Ví dụ với Ollama:

```bash
ollama pull hermes3                     # Hermes 3 (8B) — máy yếu thì giữ bản này
sudo systemctl edit ollama              # thêm:
#   [Service]
#   Environment=OLLAMA_HOST=127.0.0.1:11434
#   Environment=OLLAMA_CONTEXT_LENGTH=8192   # ≥ AI_MAX_INPUT_TOKENS + AI_MAX_TOKENS_PR, nếu không Ollama cắt prompt mà không báo
#   Environment=OLLAMA_NUM_PARALLEL=2         # = AI_MAX_CONCURRENCY
sudo systemctl restart ollama
curl -s http://127.0.0.1:11434/v1/models   # phải thấy "hermes3"
```

Cổng của model **chỉ** nghe `127.0.0.1` (hoặc mạng riêng) — kiểm bằng `ss -ltnp | grep 11434` và quét từ máy ngoài.

## 2. Cài API (một lần)

Cần Node 24 và pnpm (VPS đã có để build trang chủ). Giả sử repo ở `/srv/thaigit` — chỗ khác thì sửa đường dẫn trong `thaigit-api.service`.

```bash
cd /srv/thaigit
pnpm install --frozen-lockfile --filter @thaigit/server...

# Cấu hình + secret (ba giá trị khác nhau, chỉ root đọc được)
sudo install -m 600 -o root server/.env.example /etc/thaigit-api.env
for name in AI_ID_SECRET AI_TOKEN_SECRET TELEMETRY_ID_SECRET; do
  sudo sed -i "s|^$name=.*|$name=$(openssl rand -hex 32)|" /etc/thaigit-api.env
done
sudoedit /etc/thaigit-api.env     # chỉnh HERMES_MODEL, quota… theo sức máy

sudo cp server/deploy/thaigit-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now thaigit-api
curl -s http://127.0.0.1:8787/healthz   # {"api":"ok","db":"ok","ai":"ok"}
```

**Đừng làm mất secret**: đổi `AI_TOKEN_SECRET` thì mọi máy phải đăng ký lại (app tự làm); đổi `AI_ID_SECRET` / `TELEMETRY_ID_SECRET` thì số liệu cũ không nối được với mới.

## 3. Mở ra Internet qua Caddy / nginx

Thêm đoạn trong `server/deploy/Caddyfile.example` (Caddy) hoặc `server/deploy/nginx.conf.example` (nginx) vào khối `git.thaipro.store` sẵn có, rồi reload. Hai điểm bắt buộc: **ghi đè** `X-Real-IP` bằng IP thật, và **không đệm** SSE.

Kiểm từ máy khác:

```bash
curl -s https://git.thaipro.store/healthz
curl -sI https://git.thaipro.store/download/mac | grep -i location
```

## 4. Cập nhật tự động

Script deploy sẵn có của VPS (`/usr/local/bin/deploy-thaigit.sh`, workflow `deploy-vps.yml` gọi tới) kéo `main` rồi build trang chủ. Thêm một dòng **sau** bước kéo code:

```bash
/srv/thaigit/server/deploy/deploy.sh    # sao lưu DB → cài phụ thuộc → restart → chờ /healthz xanh
```

và thêm `'server/**'` vào `paths` của `deploy-vps.yml` để push đổi máy chủ cũng kích hoạt deploy.

## 5. Vận hành

- **Xem số liệu**: `ssh -L 8788:127.0.0.1:8788 <vps>` rồi mở http://127.0.0.1:8788 (lượt tải theo ngày, DAU/WAU/MAU, phiên bản, AI theo ngày, lỗi).
- **Tắt AI ngay** (máy quá tải, sự cố): `sudo touch /var/lib/thaigit-api/ai-disabled` — app báo "AI đang tạm tắt", mọi thứ khác vẫn chạy. Xoá file để bật lại.
- **Chặn một máy lạm dụng**: `sqlite3 /var/lib/thaigit-api/thaigit.db "INSERT INTO ai_blocked VALUES ('<id_hash>', 'lý do', strftime('%s','now'))"`.
- **Trần năng lực** (`/etc/thaigit-api.env` rồi `systemctl restart thaigit-api`): `AI_MAX_CONCURRENCY`, `AI_QUEUE_MAX`, `AI_QUEUE_TIMEOUT_S`, `AI_GLOBAL_RPM`, `AI_IP_RPM`, `AI_MAX_INPUT_TOKENS`, `AI_QUOTA_*`. Hàng đợi ưu tiên máy đã dùng thành công ở ≥ 2 ngày; máy mới chỉ chiếm tối đa ½ số luồng.
- **Sao lưu**: cron `17 3 * * * /srv/thaigit/server/deploy/backup.sh` (giữ 14 bản trong `/var/backups/thaigit-api`); `deploy.sh` cũng sao lưu trước mỗi lần cập nhật. Chép ra ngoài thì mã hoá.
- **Hạn giữ dữ liệu** (tự chạy mỗi 6 giờ): quota 7 ngày, log AI 30 ngày, máy hoạt động theo ngày 90 ngày (trước khi xoá đã gộp thành số đếm).

### Quay lại bản trước

Migration chỉ thêm bảng/cột nên bản cũ vẫn đọc được DB. Nếu bản mới hỏng:

```bash
cd /srv/thaigit && git log --oneline -5 -- server   # chọn commit cũ
git checkout <commit> -- server packages/contracts && pnpm install --filter @thaigit/server...
sudo systemctl restart thaigit-api
```

Bản cũ gặp DB đã nâng schema thì tự từ chối chạy — khi đó dừng dịch vụ, chép đè bản sao lưu `truoc-deploy-*.db` gần nhất vào `/var/lib/thaigit-api/thaigit.db`, rồi chạy lại. Xong việc nhớ `git checkout main -- server packages/contracts` để lần deploy sau kéo code bình thường.

## Chạy bằng Docker (thay cho systemd)

```bash
mkdir -p server/secrets && chmod 700 server/secrets
for f in ai_id_secret ai_token_secret telemetry_id_secret; do openssl rand -hex 32 > server/secrets/$f.txt; done
chmod 600 server/secrets/*.txt
cp server/.env.example server/.env   # bỏ trống 3 dòng secret (đã đọc từ file)
docker compose -f server/docker-compose.yml up -d --build
```

Container giới hạn 0,5 CPU / 256 MB, cổng chỉ mở trên `127.0.0.1`.

## Phát triển

```bash
pnpm --filter @thaigit/server test     # test với Hermes giả (SSE chậm, lỗi, treo, <think>)
AI_ID_SECRET=$(openssl rand -hex 32) AI_TOKEN_SECRET=$(openssl rand -hex 32) TELEMETRY_ID_SECRET=$(openssl rand -hex 32) \
  DATA_DIR=./data pnpm --filter @thaigit/server start
```
