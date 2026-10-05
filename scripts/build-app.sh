#!/bin/bash
# Build Thaigit.app từ mã nguồn.
#   ./scripts/build-app.sh            → build/Thaigit.app (bản release)
#   ./scripts/build-app.sh --install  → build rồi chép vào /Applications
#   ./scripts/build-app.sh --debug    → bản debug (build nhanh hơn)
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

# Tab "Có gì mới" trong app đọc CHANGELOG.md: thiếu file thì dừng ngay — trước khi xoá bản build/Thaigit.app đang có.
if [ ! -f CHANGELOG.md ]; then
  echo "Thiếu CHANGELOG.md (tab \"Có gì mới\" trong app đọc file này)."
  exit 1
fi

# macOS 27 SDK biến @State thành macro, cần plugin chỉ có trong Xcode.
# Khi chỉ có Command Line Tools thì build bằng SDK macOS 26 (app vẫn chạy bình thường trên macOS 27).
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

# Icon: sinh từ logo gốc (brand/thaigit-logo-source.png) nếu chưa có.
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
# Bản dịch giao diện (chuỗi gốc trong code là tiếng Việt; en.lproj là tiếng Anh). Cài đặt → Chung → Ngôn ngữ.
for lproj in Resources/*.lproj; do
  cp -R "$lproj" "$APP/Contents/Resources/"
done
# Tab "Có gì mới" trong app đọc nhật ký thay đổi này.
cp CHANGELOG.md "$APP/Contents/Resources/CHANGELOG.md"
# Ký bằng chứng chỉ cố định "Thaigit Code Signing" (tự ký, trong Keychain đăng nhập) để Keychain nhận mọi bản build /
# bản cập nhật là cùng một app — ký tạm (ad-hoc) thì mỗi bản build mới đều bị hỏi lại quyền đọc token, khoá SSH.
# Không có chứng chỉ thì ký tạm (chỉ nên dùng khi thử nghiệm); THAIGIT_SIGN_IDENTITY để chọn chứng chỉ khác.
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
