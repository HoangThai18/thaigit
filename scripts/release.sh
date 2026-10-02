#!/bin/bash
# Phát hành bản mới của Thaigit cho macOS. App đã cài sẽ tự tải bản mới về; người dùng chỉ cần khởi động lại.
#
#   ./scripts/release.sh 1.1.0 "Ghi chú bản này"            build + zip + ký → build/release/ (chưa đăng)
#   ./scripts/release.sh 1.1.0 "Ghi chú bản này" --publish  đăng luôn lên GitHub Releases (cần `gh auth login`)
#
# Lần đầu (đã làm sẵn trên máy tác giả): `swift scripts/release-tool.swift generate-key` rồi dán khoá công khai
# vào Resources/Info.plist (ThaigitUpdatePublicKey). Hãy sao lưu khoá bí mật: mất khoá thì các bản đã cài
# không nhận được bản mới (người dùng phải tải lại bằng tay).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
NOTES="${2:-}"
PUBLISH=0
[ "${3:-}" = "--publish" ] && PUBLISH=1
if [[ ! "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]]; then
  echo "Cách dùng: ./scripts/release.sh <phiên bản, ví dụ 1.1.0> \"ghi chú\" [--publish]"
  exit 1
fi
REPO="${THAIGIT_REPO:-HoangThai18/thaigit}"
PLIST=Resources/Info.plist
plist() { /usr/libexec/PlistBuddy -c "$1" "$PLIST"; }

CURRENT="$(plist 'Print :CFBundleShortVersionString')"
BUILD="$(plist 'Print :CFBundleVersion')"
if [ "$VERSION" != "$CURRENT" ]; then
  if [ "$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)" != "$VERSION" ]; then
    echo "Phiên bản $VERSION phải lớn hơn bản hiện tại $CURRENT."
    exit 1
  fi
  plist "Set :CFBundleShortVersionString $VERSION"
  plist "Set :CFBundleVersion $((BUILD + 1))"
fi

# Như build-app.sh: chỉ có Command Line Tools thì dùng SDK macOS 26 để chạy swift script.
if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
  for sdk in MacOSX26.sdk MacOSX26.5.sdk MacOSX15.sdk; do
    if [ -d "/Library/Developer/CommandLineTools/SDKs/$sdk" ]; then
      export SDKROOT="/Library/Developer/CommandLineTools/SDKs/$sdk"
      break
    fi
  done
fi

./scripts/build-app.sh

OUT=build/release
mkdir -p "$OUT"
ZIP="$OUT/Thaigit-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent build/Thaigit.app "$ZIP"
URL="https://github.com/$REPO/releases/download/v$VERSION/Thaigit-$VERSION.zip"
NOTES_FILE="$OUT/notes-$VERSION.txt"
printf '%s\n' "${NOTES:-Thaigit $VERSION}" > "$NOTES_FILE"
swift scripts/release-tool.swift manifest "$ZIP" "$VERSION" "$URL" "$NOTES_FILE" > "$OUT/update.json"
echo "✓ $ZIP"
echo "✓ $OUT/update.json"

if [ "$PUBLISH" = 1 ]; then
  gh release create "v$VERSION" "$ZIP" "$OUT/update.json" \
    --repo "$REPO" --title "Thaigit $VERSION" --notes-file "$NOTES_FILE"
  echo "✓ Đã đăng Thaigit $VERSION — máy nào đang dùng Thaigit sẽ tự tải về, khởi động lại là có bản mới."
else
  echo "Đăng lên GitHub:"
  echo "  gh release create v$VERSION \"$ZIP\" \"$OUT/update.json\" --repo $REPO --title \"Thaigit $VERSION\" --notes-file \"$NOTES_FILE\""
fi
echo "Nhớ commit Resources/Info.plist (phiên bản $VERSION)."
