#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAC_DIR="$ROOT_DIR/macOS"
WEB_DIR="$MAC_DIR/Sources/OmegaAtelierApp/Resources/web"
BUILD_DIR="$MAC_DIR/.build"
APP_NAME="Omega Atelier.app"
APP_DIR="$BUILD_DIR/$APP_NAME"

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

BIN_DIR="$MAC_DIR/.build/release"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/OmegaAtelierApp" "$APP_DIR/Contents/MacOS/OmegaAtelierApp"
cp -R "$BIN_DIR/OmegaAtelierApp_OmegaAtelierApp.bundle" "$APP_DIR/Contents/Resources/" 2>/dev/null || true

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>OMEGA Atelier</string>
  <key>CFBundleExecutable</key>
  <string>OmegaAtelierApp</string>
  <key>CFBundleIdentifier</key>
  <string>online.omegaatelier.app</string>
  <key>CFBundleName</key>
  <string>OMEGA Atelier</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "==> Launching $APP_DIR"
open -n "$APP_DIR"
