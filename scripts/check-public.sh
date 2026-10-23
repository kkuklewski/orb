#!/usr/bin/env bash
# Fails when tracked files hold private markers: Tailscale-style private addresses, plus the
# patterns in ~/.orb/private-markers or ./.private-markers (one regex per line; neither is
# committed, so the names you're guarding never end up in the repo). Run before every public push.
set -euo pipefail
cd "$(dirname "$0")/.."

markers='100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+'  # Tailscale (CGNAT) addresses
found_list=0
for f in "${ORB_STATE:-$HOME/.orb}/private-markers" .private-markers; do
  [[ -f "$f" ]] || continue
  found_list=1
  while IFS= read -r line; do [[ -n "$line" && "$line" != \#* ]] && markers+="|$line"; done < "$f"
done
[[ $found_list == 1 ]] || echo "check-public: no private-markers file; only checking for private addresses" >&2

# The author's name may appear where authorship belongs.
allowed='^(LICENSE|pyproject\.toml|uv\.lock):'

hits=$(git ls-files -z | xargs -0 grep -nIiE "$markers" -- 2>/dev/null | grep -vE "$allowed" || true)
if [[ -n "$hits" ]]; then
  echo "Private markers found:" >&2
  echo "$hits" >&2
  exit 1
fi
# Secret files never go in, whatever .gitignore says (run this after staging, before committing).
envs=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env\.example$' || true)
if [[ -n "$envs" ]]; then
  echo "Secret files are tracked or staged; unstage them (git restore --staged <file>):" >&2
  echo "$envs" >&2
  exit 1
fi
echo "check-public: clean"
