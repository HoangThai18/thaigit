#!/bin/bash
# Cập nhật API Thaigit trên VPS sau khi bản checkout đã kéo code mới (gọi từ script deploy sẵn có của VPS, chạy bằng root):
#   /srv/thaigit/server/deploy/deploy.sh
# Các bước: sao lưu DB → cài phụ thuộc → khởi động lại → chờ /healthz. Hỏng thì báo lỗi (exit 1) và KHÔNG tự sửa bản
# checkout (nó dùng chung với trang chủ) — quay bản trước bằng tay theo docs/deploy-server.md, mục "Quay lại bản trước".
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/thaigit}"
DATA_DIR="${DATA_DIR:-/var/lib/thaigit-api}"
SERVICE="${SERVICE:-thaigit-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/healthz}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/thaigit-api}"

cd "$REPO_DIR"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if [ -f "$DATA_DIR/thaigit.db" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  sqlite3 "$DATA_DIR/thaigit.db" ".backup '$BACKUP_DIR/truoc-deploy-$STAMP.db'"
  chmod 600 "$BACKUP_DIR/truoc-deploy-$STAMP.db"
  # Giữ 14 bản trước-deploy gần nhất.
  ls -1t "$BACKUP_DIR"/truoc-deploy-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
fi

pnpm install --frozen-lockfile --filter @thaigit/server... --prod=false >/dev/null
systemctl restart "$SERVICE"

wait_healthy() {
  for _ in $(seq 1 30); do
    if body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
      # Model đang tắt có chủ đích (kill switch) vẫn tính là xanh.
      if echo "$body" | grep -q '"db":"ok"' && echo "$body" | grep -Eq '"ai":"(ok|disabled)"'; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

if wait_healthy; then
  echo "✓ API Thaigit đã chạy bản $(git rev-parse --short HEAD)"
  exit 0
fi

echo "✗ /healthz không xanh sau 60 s — xem: journalctl -u $SERVICE -n 50" >&2
exit 1
