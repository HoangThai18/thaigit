#!/bin/bash
# Releases a new Thaigit version for macOS. Installed apps download the new version themselves; users only need to restart.
#
#   ./scripts/release.sh 1.1.0 "Release note"            build + zip + sign → build/release/ (not uploaded yet)
#   ./scripts/release.sh 1.1.0 "Release note" --publish  also publish to GitHub Releases (needs `gh auth login`)
#
# First time (already done on the author's machine): run `swift scripts/release-tool.swift generate-key`, then paste the
# public key into Resources/Info.plist (ThaigitUpdatePublicKey). Back up the secret key: lose it and installed versions
# cannot receive updates (users would have to download manually).
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

# CHANGELOG.md (the app's "What's new" tab reads this file): the "## Unreleased" section becomes "## <version> — <date>".
# After the change there must be EXACTLY ONE "## <version> " heading — none (forgot the changelog) or duplicates (this
# version was already released, or two "Unreleased" sections) aborts the release. Check BEFORE bumping the version in
# Info.plist, so a mistake changes nothing.
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

# Turn "## Unreleased" in CHANGELOG.md into "## <version> — <date>" (already verified above: exactly one section).
if grep -q '^## Chưa phát hành' CHANGELOG.md; then
  sed -i '' "s/^## Chưa phát hành.*/## $VERSION — $(date +%Y-%m-%d)/" CHANGELOG.md
fi
if [ "$(changelog_headings)" -ne 1 ]; then
  echo "CHANGELOG.md sau khi đổi tiêu đề không có đúng một mục \"## $VERSION\" — kiểm tra lại file."
  exit 1
fi

# As in build-app.sh: with only Command Line Tools, run swift scripts against the macOS 26 SDK.
if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
  for sdk in MacOSX26.sdk MacOSX26.5.sdk MacOSX15.sdk; do
    if [ -d "/Library/Developer/CommandLineTools/SDKs/$sdk" ]; then
      export SDKROOT="/Library/Developer/CommandLineTools/SDKs/$sdk"
      break
    fi
  done
fi

./scripts/build-app.sh
# A release must be signed with the stable certificate — ad-hoc signing makes Keychain re-prompt after every update.
if ! codesign -dr - build/Thaigit.app 2>&1 | grep -q "certificate leaf"; then
  echo "✗ build/Thaigit.app chưa ký bằng chứng chỉ \"${THAIGIT_SIGN_IDENTITY:-Thaigit Code Signing}\" — dừng phát hành" >&2
  exit 1
fi

OUT=build/release
mkdir -p "$OUT"
# A fixed filename so the homepage can always point at the newest release: releases/latest/download/Thaigit-macOS.zip
ZIP="$OUT/Thaigit-macOS.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent build/Thaigit.app "$ZIP"
# The self-updater downloads a differently-named copy (same content, same signature) so GitHub's download counts can separate
# "downloaded from the homepage" (Thaigit-macOS.zip) from "self-update" (Thaigit-macOS-update.zip) — see scripts/download-stats.mjs.
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
