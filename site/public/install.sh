#!/bin/sh
# Installs Gitlane on macOS from the GitHub release:  curl -fsSL https://git.thaipro.store/install.sh | sh
#
# Why this exists: the app is only ad-hoc signed (no paid Developer ID), so Gatekeeper blocks a dmg downloaded in a
# browser. curl does not set the quarantine flag, so an app installed this way opens without that prompt.
# GITLANE_CHANNEL=desktop-beta installs the beta channel instead of stable.
set -eu

REPO='HoangThai18/thaigit'
CHANNEL="${GITLANE_CHANNEL:-desktop-stable}"
URL="https://github.com/$REPO/releases/download/$CHANNEL/Gitlane-macOS.dmg"

case "${LC_ALL:-${LANG:-}}" in vi*) LANG_VI=1 ;; *) LANG_VI=0 ;; esac
say() { if [ "$LANG_VI" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
die() { say "Lỗi: $1" "Error: $2" >&2; exit 1; }

# Everything runs from one function that is called on the last line: a download cut short never executes half a script.
main() {
  [ "$(uname -s)" = Darwin ] || die 'script này chỉ dành cho macOS.' 'this script is for macOS only.'
  # hw.optional.arm64 is 1 on Apple silicon even when the shell runs under Rosetta (where uname -m says x86_64).
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] ||
    die 'bản tải sẵn chỉ có cho Mac chip Apple (M1 trở lên).' 'the prebuilt app is for Apple-silicon Macs (M1 or later) only.'

  if [ -w /Applications ]; then DEST=/Applications; else DEST="$HOME/Applications"; fi
  APP="$DEST/Gitlane.app"
  if pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; then
    die 'Gitlane đang chạy — hãy thoát app rồi chạy lại lệnh.' 'Gitlane is running — quit it and run the command again.'
  fi

  TMP="$(mktemp -d)"
  MNT="$TMP/mnt"
  cleanup() {
    hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true
    rm -rf "$TMP"
  }
  trap cleanup EXIT INT TERM

  say 'Đang tải Gitlane…' 'Downloading Gitlane…'
  curl -fL --progress-bar -o "$TMP/Gitlane.dmg" "$URL" </dev/null ||
    die "không tải được $URL" "could not download $URL"

  mkdir -p "$MNT"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MNT" "$TMP/Gitlane.dmg" </dev/null ||
    die 'không mở được file dmg.' 'could not open the dmg.'
  SRC="$(find "$MNT" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$SRC" ] || die 'file dmg không chứa app.' 'the dmg does not contain an app.'

  mkdir -p "$DEST"
  rm -rf "$APP"
  ditto "$SRC" "$APP"
  # No-op for a curl download; kept so the result is the same if the dmg was ever tagged.
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  codesign --verify --deep "$APP" 2>/dev/null ||
    die 'chữ ký của app không hợp lệ.' 'the app signature is not valid.'

  say "Đã cài Gitlane vào $DEST. Mở bằng: open \"$APP\"" "Installed Gitlane in $DEST. Open it with: open \"$APP\""
}

main "$@"
