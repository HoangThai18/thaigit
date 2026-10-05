#!/bin/bash
# Retakes the macOS app screenshots for the README + homepage (docs/screenshots/*.png), then generates the WebP variants the
# homepage uses.
#
#     ./site/scripts/take-shots.sh            # debug build, create the demo repos, take 10 shots, run make-shots.py
#
# It uses the automation harness already in the app (Sources/Nhanh/Debug/AutomationHarness.swift: NHANH_SNAPSHOT_DIR /
# NHANH_STEPS). The demo repos are created in /tmp/thaigit-shots (this path shows on the welcome screen, so keep it short).
# The app's settings (com.phanthai.thaigit) are backed up before and restored afterwards — recently opened repos, the commit
# draft… none of it leaks into your machine. The app windows open and close one by one (~1 minute); don't click them while
# the shots are being taken.
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
# Keep the current layout (sidebar width, graph columns) but drop stale tabs / recent repos; letter avatars (no network calls).
for key in openTabs openTabsSelected recentRepositories commitDrafts.v1; do defaults delete "$DOMAIN" "$key" 2>/dev/null || true; done
defaults write "$DOMAIN" realAvatars -bool false
defaults write "$DOMAIN" snapshotNoticeShown -bool true

# shot <repo|-> <appearance> <steps>
shot() {
    local repo=$1 appearance=$2 steps=$3
    local env=(NHANH_SNAPSHOT_DIR="$OUT" NHANH_APPEARANCE="$appearance" NHANH_STEPS="$steps")
    # The welcome screen is only shot when NHANH_OPEN is absent (even when empty).
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
# Welcome screen: three demo repos under "Recent".
defaults write "$DOMAIN" recentRepositories -array "$BASE/large" "$BASE/xung-dot" "$BASE/demo-shop"
shot - light "$SIZE"

for name in overview overview-dark diff-lines diff-split image-diff drag switch conflict large welcome; do
    [ -f "$OUT/$name.png" ] || { echo "Thiếu ảnh $name.png — xem lại kịch bản" >&2; exit 1; }
    # Screenshots are captured at Retina resolution (2880 px): scale down to 1600 px to keep the README light.
    sips -Z 1600 "$OUT/$name.png" --out "$ROOT/docs/screenshots/$name.png" >/dev/null
done
python3 "$ROOT/site/scripts/make-shots.py"
echo "✓ docs/screenshots + site/public/screenshots"
