#!/bin/sh
# Builds mic.wav for run.mjs: 1.5 s silence, q1, 16 s silence, q2 (lands while she answers q1), 25 s silence.
set -e
cd "$(dirname "$0")"
say() { curl -sf -o "$1" http://127.0.0.1:8880/v1/audio/speech -H 'Content-Type: application/json' \
  -d "{\"model\":\"kokoro\",\"voice\":\"am_michael\",\"input\":\"$2\",\"response_format\":\"wav\"}"; }
say q1.wav "Please tell me, in four or five spoken sentences, what a voice dashboard is good for. Don't use any tools."
say q2.wav "Stop. Actually, just tell me what two plus two is."
ffmpeg -v error -y -f lavfi -t 1.5 -i anullsrc=r=48000:cl=mono -i q1.wav -f lavfi -t 16 -i anullsrc=r=48000:cl=mono \
  -i q2.wav -f lavfi -t 25 -i anullsrc=r=48000:cl=mono \
  -filter_complex "[1]aresample=48000[a];[3]aresample=48000[b];[0][a][2][b][4]concat=n=5:v=0:a=1" \
  -ac 1 -ar 48000 -c:a pcm_s16le mic.wav
