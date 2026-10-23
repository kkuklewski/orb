#!/bin/sh
# Starts Orb when you log in and restarts it after a crash (macOS launchd). Logs: ~/.orb/logs/.
# Undo: launchctl bootout gui/$(id -u)/dev.orb.server && rm ~/Library/LaunchAgents/dev.orb.server.plist
set -e
ORB=$(command -v orb) || { echo "orb is not on PATH; install it first: uv tool install git+https://github.com/kkuklewski/orb" >&2; exit 1; }
PLIST=~/Library/LaunchAgents/dev.orb.server.plist
mkdir -p ~/.orb/logs ~/Library/LaunchAgents
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.orb.server</string>
  <key>ProgramArguments</key><array><string>$ORB</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.orb/logs/orb.log</string>
  <key>StandardErrorPath</key><string>$HOME/.orb/logs/orb.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Orb starts at login. Its link is in ~/.orb/logs/orb.log."
