#!/usr/bin/env bash
# Builds Orb.app: clicking it opens Terminal, starts Orb there and opens the page in the browser.
# Usage: scripts/make-app.sh [dest-dir]   (default ~/Applications). Paths are baked in at build time.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$HOME/Applications}"
app="$dest/Orb.app"
# A personal start script (e.g. ~/bin/orb that loads env) wins over a plain `uv run orb`.
if [ -x "$HOME/bin/orb" ]; then cmd="$HOME/bin/orb"; else cmd="cd '$repo' && uv run orb"; fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Orb</string>
  <key>CFBundleIdentifier</key><string>local.orb.launcher</string>
  <key>CFBundleExecutable</key><string>orb-launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
cat > "$app/Contents/MacOS/orb-launcher" <<LAUNCH
#!/usr/bin/env bash
osascript <<'OSA'
tell application "Terminal"
  activate
  do script "export PATH=\"\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH\"; ORB_OPEN=1 $cmd"
end tell
OSA
LAUNCH
chmod +x "$app/Contents/MacOS/orb-launcher"
echo "Built $app"
