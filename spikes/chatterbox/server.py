"""Chatterbox Multilingual (Polish + English) behind a Kokoro-like endpoint, for trying it as a voice.

Runs in its own Python 3.11 env (torch 2.6, chatterbox-tts 0.1.7), not the dashboard's:
    ~/.orb/chatterbox/.venv/bin/python spikes/chatterbox/server.py
POST /v1/audio/speech {"input": "...", "language": "pl"|"en"} -> WAV. GET /health. 127.0.0.1 only.
Slow on the Mac (~0.5x real time on MPS): one request at a time.
"""

import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

HOST, PORT = "127.0.0.1", 8881
model = ChatterboxMultilingualTTS.from_pretrained(device="mps" if torch.backends.mps.is_available() else "cpu")
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200 if self.path == "/health" else 404, b"{}", "application/json")

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self._send(404, b"{}", "application/json")
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        text, lang = str(req.get("input", "")).strip(), req.get("language") or "en"
        if not text:
            return self._send(400, b'{"error": "no input"}', "application/json")
        t = time.perf_counter()
        with lock, torch.inference_mode():
            wav = model.generate(text, language_id=lang)
        buf = io.BytesIO()
        ta.save(buf, wav.cpu(), model.sr, format="wav", encoding="PCM_S", bits_per_sample=16)
        print(f"{lang} {time.perf_counter() - t:.1f}s for {wav.shape[-1] / model.sr:.1f}s: {text[:60]}", flush=True)
        self._send(200, buf.getvalue(), "audio/wav")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"chatterbox on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
