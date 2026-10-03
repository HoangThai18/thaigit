#!/bin/bash
# Chụp lại ảnh giao diện app macOS cho README + trang chủ (docs/screenshots/*.png), rồi sinh WebP cho trang chủ.
#
#     ./site/scripts/take-shots.sh            # build bản debug, dựng repo demo, chụp 10 ảnh, chạy make-shots.py
#
# Dùng kịch bản tự động có sẵn trong app (Sources/Nhanh/Debug/AutomationHarness.swift: NHANH_SNAPSHOT_DIR / NHANH_STEPS).
# Repo demo dựng ở /tmp/thaigit-shots (đường dẫn này hiện trên màn hình chào nên giữ ngắn gọn). Cài đặt của app
# (com.phanthai.thaigit) được sao lưu trước và trả lại sau khi chụp — repo đã mở, bản nháp commit… không lẫn vào máy bạn.
# Các cửa sổ app sẽ lần lượt bật lên rồi tự đóng (~1 phút); đừng bấm vào chúng trong lúc chụp.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE=/tmp/thaigit-shots
OUT="$BASE/out"
APP="$ROOT/build/Thaigit.app/Contents/MacOS/Thaigit"
DOMAIN=com.phanthai.thaigit
BACKUP="$BASE-defaults.plist"
SIZE=size:1440x840

"$ROOT/scripts/build-app.sh" --debug >/dev/null
python3 "$ROOT/site/scripts/make-demo-repos.py" "$BASE"
mkdir -p "$OUT"

defaults export "$DOMAIN" "$BACKUP" 2>/dev/null || rm -f "$BACKUP"
restore() {
    if [ -f "$BACKUP" ]; then defaults import "$DOMAIN" "$BACKUP"; rm -f "$BACKUP"; else defaults delete "$DOMAIN" 2>/dev/null || true; fi
}
trap restore EXIT
# Giữ bố cục đang dùng (bề rộng sidebar, cột graph) nhưng bỏ tab cũ / repo gần đây; ảnh đại diện chữ cái (không gọi mạng).
for key in openTabs openTabsSelected recentRepositories commitDrafts.v1; do defaults delete "$DOMAIN" "$key" 2>/dev/null || true; done
defaults write "$DOMAIN" realAvatars -bool false
defaults write "$DOMAIN" snapshotNoticeShown -bool true

# shot <repo|-> <giao diện> <các bước>
shot() {
    local repo=$1 appearance=$2 steps=$3
    local env=(NHANH_SNAPSHOT_DIR="$OUT" NHANH_APPEARANCE="$appearance" NHANH_STEPS="$steps")
    # Màn hình chào chỉ chụp khi KHÔNG có biến NHANH_OPEN (kể cả rỗng).
    [ "$repo" != "-" ] && env+=(NHANH_OPEN="$BASE/$repo")
    env "${env[@]}" "$APP" -AppleLanguages '(vi)' -ApplePersistenceIgnoreState YES >/dev/null 2>&1 || true
}

WIP="$SIZE,wait:3,select:wip,wait:1"
shot demo-shop light "$WIP,summary:Đăng nhập qua API /login,snap:overview,quit"
shot demo-shop dark "$WIP,summary:Đăng nhập qua API /login,snap:overview-dark,quit"
shot demo-shop light "$WIP,split:off,open:src/app.js,wait:1,selectlines:3,snap:diff-lines,quit"
shot demo-shop light "$WIP,split:on,open:src/app.js,wait:1,snap:diff-split,split:off,quit"
shot demo-shop light "$WIP,open:public/logo.png,wait:1.5,snap:image-diff,quit"
shot demo-shop light "$SIZE,wait:3,select:head,wait:1,drag:feature/giao-dien>main,wait:1,snap:drag,quit"
shot demo-shop light "$SIZE,wait:3,select:head,wait:1,act:switchbranch,wait:1,snap:switch,quit"
shot xung-dot light "$SIZE,wait:3,select:wip,wait:1,open:conflict,wait:1.5,snap:conflict,quit"
shot large light "$SIZE,ready,wait:2,select:4,wait:1.5,snap:large,quit"
# Màn hình chào: ba repo demo trong "Mở gần đây".
defaults write "$DOMAIN" recentRepositories -array "$BASE/large" "$BASE/xung-dot" "$BASE/demo-shop"
shot - light "$SIZE"

for name in overview overview-dark diff-lines diff-split image-diff drag switch conflict large welcome; do
    [ -f "$OUT/$name.png" ] || { echo "Thiếu ảnh $name.png — xem lại kịch bản" >&2; exit 1; }
    # Ảnh chụp ở độ phân giải Retina (2880 px): thu về 1600 px cho README nhẹ.
    sips -Z 1600 "$OUT/$name.png" --out "$ROOT/docs/screenshots/$name.png" >/dev/null
done
python3 "$ROOT/site/scripts/make-shots.py"
echo "✓ docs/screenshots + site/public/screenshots"
