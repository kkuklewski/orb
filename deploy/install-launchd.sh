#!/bin/sh
# Starts Orb when you log in and restarts it after a crash (macOS launchd). Logs: ~/.orb/logs/. Open the page: orb open.
# Tracker settings exported in this shell (ORB_VIKUNJA_TOKEN, ORB_JIRA_EMAIL, ORB_JIRA_TOKEN, ORB_VIKUNJA_URL,
# ORB_JIRA_URL, ORB_JIRA_JQL) go into the job's EnvironmentVariables, in a plist only you can read (0600); never
# into settings.json. Running it again keeps the ones you don't export; export one empty (ORB_JIRA_TOKEN=) to drop it.
# Undo: launchctl bootout gui/$(id -u)/dev.orb.server && rm ~/Library/LaunchAgents/dev.orb.server.plist
set -e
umask 077
ORB=$(command -v orb) || { echo "orb is not on PATH; install it first: uv tool install git+https://github.com/kkuklewski/orb" >&2; exit 1; }
PLIST=~/Library/LaunchAgents/dev.orb.server.plist
BUDDY=/usr/libexec/PlistBuddy
mkdir -p ~/.orb/logs ~/Library/LaunchAgents

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

envs=""
for name in ORB_VIKUNJA_URL ORB_VIKUNJA_TOKEN ORB_JIRA_URL ORB_JIRA_EMAIL ORB_JIRA_TOKEN ORB_JIRA_JQL; do
  if eval "[ -n \"\${$name+x}\" ]"; then
    eval "value=\${$name}"  # exported here, even empty (empty drops it)
  elif [ -f "$PLIST" ] && [ -x "$BUDDY" ]; then
    value=$("$BUDDY" -c "Print :EnvironmentVariables:$name" "$PLIST" 2>/dev/null) || value=""
  else
    value=""
  fi
  [ -n "$value" ] && envs="$envs    <key>$name</key><string>$(xml "$value")</string>
" && echo "Passing $name to the login job." || true
done
env_block=""
[ -n "$envs" ] && env_block="  <key>EnvironmentVariables</key><dict>
$envs  </dict>
"

TMP=$(mktemp "$PLIST.XXXXXX")
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.orb.server</string>
  <key>ProgramArguments</key><array><string>$(xml "$ORB")</string></array>
$env_block  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$HOME")/.orb/logs/orb.log</string>
  <key>StandardErrorPath</key><string>$(xml "$HOME")/.orb/logs/orb.log</string>
</dict>
</plist>
EOF
chmod 600 "$TMP"
mv -f "$TMP" "$PLIST"
trap - EXIT

launchctl bootout "gui/$(id -u)/dev.orb.server" 2>/dev/null || true  # a re-run replaces the running job
tries=0
until launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; do  # bootout finishes in the background
  tries=$((tries + 1))
  [ "$tries" -lt 5 ] || { launchctl bootstrap "gui/$(id -u)" "$PLIST"; exit 1; }
  sleep 1
done
echo "Orb starts at login. Open the page with: orb open"
