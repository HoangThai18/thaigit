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

# CHANGELOG.md (tab "Có gì mới" trong app đọc file này): mục "## Chưa phát hành" sẽ thành "## <phiên bản> — <ngày>".
# Sau khi đổi phải có ĐÚNG MỘT tiêu đề "## <phiên bản> " — không có (quên ghi nhật ký) hoặc trùng (bản này đã phát hành,
# hay có hai mục "Chưa phát hành") thì dừng. Kiểm tra TRƯỚC khi tăng phiên bản trong Info.plist để không đụng gì khi sai.
VERSION_RE="${VERSION//./\\.}"
changelog_headings() { grep -cE "^## ${VERSION_RE}( |\$)" CHANGELOG.md || true; }
UNRELEASED="$(grep -c '^## Chưa phát hành' CHANGELOG.md || true)"
if [ ! -f CHANGELOG.md ] || [ $(( $(changelog_headings) + UNRELEASED )) -ne 1 ]; then
  echo "CHANGELOG.md phải có đúng một mục cho bản $VERSION (\"## Chưa phát hành\" hoặc \"## $VERSION — <ngày>\");"
  echo "đang có $(changelog_headings) mục \"## $VERSION\" và ${UNRELEASED:-0} mục \"## Chưa phát hành\". Chưa thay đổi gì."
  exit 1
fi

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

# Mục "## Chưa phát hành" trong CHANGELOG.md thành "## <phiên bản> — <ngày>" (đã kiểm ở trên: chỉ có một mục).
if grep -q '^## Chưa phát hành' CHANGELOG.md; then
  sed -i '' "s/^## Chưa phát hành.*/## $VERSION — $(date +%Y-%m-%d)/" CHANGELOG.md
fi
if [ "$(changelog_headings)" -ne 1 ]; then
  echo "CHANGELOG.md sau khi đổi tiêu đề không có đúng một mục \"## $VERSION\" — kiểm tra lại file."
  exit 1
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
# Bản phát hành phải ký bằng chứng chỉ cố định — ký tạm thì người dùng bị Keychain hỏi lại quyền sau mỗi lần cập nhật.
if ! codesign -dr - build/Thaigit.app 2>&1 | grep -q "certificate leaf"; then
  echo "✗ build/Thaigit.app chưa ký bằng chứng chỉ \"${THAIGIT_SIGN_IDENTITY:-Thaigit Code Signing}\" — dừng phát hành" >&2
  exit 1
fi

OUT=build/release
mkdir -p "$OUT"
# Tên file cố định để trang chủ luôn trỏ được tới bản mới nhất: releases/latest/download/Thaigit-macOS.zip
ZIP="$OUT/Thaigit-macOS.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent build/Thaigit.app "$ZIP"
# Bộ tự cập nhật tải một bản sao tên khác (cùng nội dung, cùng chữ ký) để số lượt tải trên GitHub tách được "tải mới từ
# trang chủ" (Thaigit-macOS.zip) với "tự cập nhật" (Thaigit-macOS-update.zip) — xem scripts/download-stats.mjs.
UPDATE_ZIP="$OUT/Thaigit-macOS-update.zip"
cp "$ZIP" "$UPDATE_ZIP"
URL="https://github.com/$REPO/releases/download/v$VERSION/Thaigit-macOS-update.zip"
NOTES_FILE="$OUT/notes-$VERSION.txt"
printf '%s\n' "${NOTES:-Thaigit $VERSION}" > "$NOTES_FILE"
swift scripts/release-tool.swift manifest "$ZIP" "$VERSION" "$URL" "$NOTES_FILE" > "$OUT/update.json"
echo "✓ $ZIP"
echo "✓ $UPDATE_ZIP"
echo "✓ $OUT/update.json"

if [ "$PUBLISH" = 1 ]; then
  gh release create "v$VERSION" "$ZIP" "$UPDATE_ZIP" "$OUT/update.json" \
    --repo "$REPO" --title "Thaigit $VERSION" --notes-file "$NOTES_FILE"
  echo "✓ Đã đăng Thaigit $VERSION — máy nào đang dùng Thaigit sẽ tự tải về, khởi động lại là có bản mới."
else
  echo "Đăng lên GitHub:"
  echo "  gh release create v$VERSION \"$ZIP\" \"$UPDATE_ZIP\" \"$OUT/update.json\" --repo $REPO --title \"Thaigit $VERSION\" --notes-file \"$NOTES_FILE\""
fi
echo "Nhớ commit Resources/Info.plist và CHANGELOG.md (phiên bản $VERSION)."
