"""Self-hosted runtime assets for the browser VAD.

vad-web and onnxruntime-web load a worklet, the Silero model and a WASM runtime at run time,
which SRI cannot cover. They are downloaded once, checked against these sha384 pins, and served
from /static/vendor. Run: uv run orb-vendor (the server also does it at start).
"""

from __future__ import annotations

import base64
import hashlib
import sys
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).parent / "static" / "vendor"

FILES = {
    "vad.worklet.bundle.min.js": ("https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/vad.worklet.bundle.min.js", "sha384-eVdRJTf42y/6FIezPEAxJtOyHFmgLDFMUD4G0XK+UvEdggoBIes9bwY4HfXaMdEw"),
    "silero_vad_v5.onnx": ("https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/silero_vad_v5.onnx", "sha384-QOg8DceFufArVWI/JMC5mEA6vTt4aOLos8k86P47Nmwu4JiItUq7QK1SFgLqvfwF"),
    "ort-wasm-simd-threaded.mjs": ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.mjs", "sha384-XcXA/MtAf0WpB8e023xQH9CM7RIjiugakT7x99DIwpFf7k56BIFFcAPerIF7FDad"),
    "ort-wasm-simd-threaded.wasm": ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm", "sha384-vjBJ1z7qrhkTyYsNqKeF6c7N+nOJSU94czEo+tvZcu8G75JparGq9kB+kTnEUNVM"),
}


def _sri(data: bytes) -> str:
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()


def ensure() -> None:
    """Download missing files; raise if any file does not match its pin."""
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name, (url, pin) in FILES.items():
        path = VENDOR / name
        if path.exists() and _sri(path.read_bytes()) == pin:
            continue
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        if _sri(data) != pin:
            raise RuntimeError(f"{name}: download does not match its pinned hash; refusing to serve it")
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)


def main() -> None:
    try:
        ensure()
    except Exception as e:  # noqa: BLE001
        print(e, file=sys.stderr)
        raise SystemExit(1) from None
    print(f"vendor assets ok in {VENDOR}")
