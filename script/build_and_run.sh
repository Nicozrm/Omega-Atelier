#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="OmegaAtelierApp"
BUNDLE_NAME="Omega Atelier.app"
BUNDLE_ID="online.omegaatelier.app"
MIN_SYSTEM_VERSION="13.0"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_DIR="$ROOT_DIR/macOS"
WEB_DIR="$MAC_DIR/Sources/OmegaAtelierApp/Resources/web"
DIST_DIR="$ROOT_DIR/dist-macos"
APP_BUNDLE="$DIST_DIR/$BUNDLE_NAME"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -x "Omega Atelier" >/dev/null 2>&1 || true

cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
  echo "==> Installing web dependencies"
  npm ci
fi

echo "==> Building OMEGA Atelier web app"
GITHUB_PAGES_BASE=./ npm run build

rm -rf "$WEB_DIR"
mkdir -p "$WEB_DIR"
cp -R "$ROOT_DIR/dist/." "$WEB_DIR/"

echo "==> Building native macOS app"
cd "$MAC_DIR"
swift build -c release
BUILD_BINARY="$(swift build --show-bin-path)/$APP_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_CONTENTS/Resources"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"

BUNDLE_RESOURCE="$(find "$MAC_DIR/.build" -type d -name 'OmegaAtelierApp_OmegaAtelierApp.bundle' -print -quit)"
if [ -n "$BUNDLE_RESOURCE" ]; then
  cp -R "$BUNDLE_RESOURCE" "$APP_CONTENTS/Resources/"
fi

cat > "$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>OMEGA Atelier</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>OMEGA Atelier</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

if [ -f "$ROOT_DIR/macOS/AppIcon.icns" ]; then
  cp "$ROOT_DIR/macOS/AppIcon.icns" "$APP_CONTENTS/Resources/AppIcon.icns"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$INFO_PLIST" 2>/dev/null || true
fi

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    echo "OMEGA Atelier is running."
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
