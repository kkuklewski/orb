#!/bin/sh
# Echo spike: needs Kokoro on :8880 and audible MacBook speakers. Prints the result JSON.
set -e
cd "$(dirname "$0")"
i=0
for t in "Here is a quick summary of what I found in the repository. The deploy script uses rsync with the delete flag, so running it from the wrong machine could remove the environment file on the server." \
         "I wrote the three steps in the chat. First, deploy from your computer. Then give the bot the events permission. Finally, test it on the admin channel and tell me what you see." \
         "If anything looks wrong, stop me and I will check the logs again. Otherwise we can move on to the next task in the voice dashboard project."; do
  i=$((i+1))
  [ -f clip$i.wav ] || curl -sf -o clip$i.wav http://127.0.0.1:8880/v1/audio/speech -H 'Content-Type: application/json' \
    -d "{\"model\":\"kokoro\",\"voice\":\"af_sky\",\"input\":\"$t\",\"response_format\":\"wav\"}"
done
python3 -m http.server 8799 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 1
node run.mjs 2>console.log
