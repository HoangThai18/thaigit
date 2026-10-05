#!/bin/bash
# Builds Thaigit.app from source.
#   ./scripts/build-app.sh            → build/Thaigit.app (release build)
#   ./scripts/build-app.sh --install  → build, then copy into /Applications
#   ./scripts/build-app.sh --debug    → debug build (faster)
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="release"
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --debug) CONFIG="debug" ;;
    --install) INSTALL=1 ;;
  esac
done

# The app's "What's new" tab reads CHANGELOG.md: stop immediately when the file is missing — before deleting the existing build/Thaigit.app.
if [ ! -f CHANGELOG.md ]; then
  echo "Thiếu CHANGELOG.md (tab \"Có gì mới\" trong app đọc file này)."
  exit 1
fi

# The macOS 27 SDK turns @State into a macro, which needs a plugin only present in Xcode.
# With just Command Line Tools installed, build against the macOS 26 SDK (the app still runs fine on macOS 27).
if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
  for sdk in MacOSX26.sdk MacOSX26.5.sdk MacOSX15.sdk; do
    if [ -d "/Library/Developer/CommandLineTools/SDKs/$sdk" ]; then
      export SDKROOT="/Library/Developer/CommandLineTools/SDKs/$sdk"
      break
    fi
  done
fi

echo "▸ swift build -c $CONFIG ${SDKROOT:+(SDK: $(basename "$SDKROOT"))}"
swift build -c "$CONFIG" --product Nhanh
BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"

# Icon: generated from the source logo (brand/thaigit-logo-source.png) when missing.
if [ ! -f Resources/AppIcon.icns ]; then
  echo "▸ Tạo icon"
  python3 scripts/make-icons.py
fi

APP="build/Thaigit.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/Nhanh" "$APP/Contents/MacOS/Thaigit"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# UI translations (strings in code are Vietnamese; en.lproj is English). Settings → General → Language.
for lproj in Resources/*.lproj; do
  cp -R "$lproj" "$APP/Contents/Resources/"
done
# The app's "What's new" tab reads this changelog.
cp CHANGELOG.md "$APP/Contents/Resources/CHANGELOG.md"
# Sign with the stable certificate "Thaigit Code Signing" (self-signed, in the login Keychain) so Keychain treats every build /
# update as the same app — ad-hoc signing makes Keychain re-prompt for token and SSH key access on every build.
# Without a certificate the build is signed ad-hoc (only for experiments); set THAIGIT_SIGN_IDENTITY to pick another one.
IDENTITY="${THAIGIT_SIGN_IDENTITY:-Thaigit Code Signing}"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$IDENTITY\""; then
  codesign --force --sign "$IDENTITY" --timestamp=none "$APP" >/dev/null
  echo "✓ Đã ký bằng chứng chỉ \"$IDENTITY\""
else
  codesign --force --sign - --timestamp=none "$APP" >/dev/null
  echo "⚠︎ Không có chứng chỉ \"$IDENTITY\" — ký tạm (Keychain sẽ hỏi lại quyền sau mỗi bản build)"
fi
echo "✓ Đã tạo $APP"

if [ "$INSTALL" = 1 ]; then
  rm -rf "/Applications/Thaigit.app"
  cp -R "$APP" /Applications/
  echo "✓ Đã cài vào /Applications/Thaigit.app"
fi
