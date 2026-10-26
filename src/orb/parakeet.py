"""Parakeet TDT v3 (speech to text) in-process, through whisper.cpp's libparakeet.

The model stays loaded, so a request is only encode + decode (~0.15 s for 5 s of speech on an
M4 Pro, against ~0.5 s for Whisper large-v3-turbo). The library comes from voicemode's
whisper.cpp build (read only, never rebuilt here); the model lives in ~/.orb/models.
Parakeet takes no vocabulary prompt, so it mishears unusual names (Vikunja -> "Vicanya"). Those
words come out with low confidence (<= 0.64 measured), but so do ordinary words in real mic speech
("Hey there" at 0.61), so speech.transcribe asks Whisper only when an unsure word sounds like a
vocabulary name.
Anything missing or failing -> None, and speech.transcribe falls back to Whisper.
"""

from __future__ import annotations

import atexit
import ctypes as C
import io
import logging
import os
import threading
import wave
from array import array
from pathlib import Path

from . import config

log = logging.getLogger("orb.parakeet")

LIB = Path(config.env("PARAKEET_LIB",
                          config.HOME / ".voicemode/services/whisper/build/bin/libparakeet.dylib"))
MODEL = Path(config.env("PARAKEET_MODEL",
                            config.STATE_DIR / "models/ggml-parakeet-tdt-0.6b-v3-f16.bin"))
RATE = 16000  # the page sends 16 kHz mono 16-bit WAV
THREADS = 4
MIN_P = float(config.env("PARAKEET_MIN_P", "0.75"))


class _ContextParams(C.Structure):
    _fields_ = [("use_gpu", C.c_bool), ("gpu_device", C.c_int)]


class _FullParams(C.Structure):  # parakeet.h: struct parakeet_full_params
    _fields_ = [("strategy", C.c_int), ("n_threads", C.c_int), ("offset_ms", C.c_int), ("duration_ms", C.c_int),
                ("no_context", C.c_bool), ("audio_ctx", C.c_int),
                ("new_segment_callback", C.c_void_p), ("new_segment_callback_user_data", C.c_void_p),
                ("new_token_callback", C.c_void_p), ("new_token_callback_user_data", C.c_void_p),
                ("progress_callback", C.c_void_p), ("progress_callback_user_data", C.c_void_p),
                ("encoder_begin_callback", C.c_void_p), ("encoder_begin_callback_user_data", C.c_void_p),
                ("abort_callback", C.c_void_p), ("abort_callback_user_data", C.c_void_p)]


_LOG_CB = C.CFUNCTYPE(None, C.c_int, C.c_char_p, C.c_void_p)
_quiet = _LOG_CB(lambda level, text, data: None)  # kept alive: the library holds the pointer


class Parakeet:
    def __init__(self, lib: Path = LIB, model: Path = MODEL):
        self.lib = C.CDLL(str(lib))
        L = self.lib
        L.parakeet_log_set.argtypes = [_LOG_CB, C.c_void_p]
        L.parakeet_log_set(_quiet, None)
        L.parakeet_context_default_params.restype = _ContextParams
        L.parakeet_init_from_file_with_params.argtypes = [C.c_char_p, _ContextParams]
        L.parakeet_init_from_file_with_params.restype = C.c_void_p
        L.parakeet_full_default_params.argtypes = [C.c_int]
        L.parakeet_full_default_params.restype = _FullParams
        L.parakeet_full.argtypes = [C.c_void_p, _FullParams, C.POINTER(C.c_float), C.c_int]
        L.parakeet_full.restype = C.c_int
        L.parakeet_full_n_segments.argtypes = [C.c_void_p]
        L.parakeet_full_get_segment_text.argtypes = [C.c_void_p, C.c_int]
        L.parakeet_full_get_segment_text.restype = C.c_char_p
        L.parakeet_full_n_tokens.argtypes = [C.c_void_p, C.c_int]
        L.parakeet_full_get_token_text.argtypes = [C.c_void_p, C.c_int, C.c_int]
        L.parakeet_full_get_token_text.restype = C.c_char_p
        L.parakeet_full_get_token_p.argtypes = [C.c_void_p, C.c_int, C.c_int]
        L.parakeet_full_get_token_p.restype = C.c_float
        L.parakeet_free.argtypes = [C.c_void_p]
        cparams = L.parakeet_context_default_params()
        cparams.use_gpu = True
        self.ctx = L.parakeet_init_from_file_with_params(str(model).encode(), cparams)
        if not self.ctx:
            raise RuntimeError(f"parakeet: could not load {model}")
        self.lock = threading.Lock()  # one context: one request at a time
        atexit.register(self.close)  # an unfreed Metal context aborts the process at exit

    def close(self) -> None:
        with self.lock:
            if self.ctx:
                self.lib.parakeet_free(self.ctx)
                self.ctx = None

    def transcribe_pcm(self, samples: array) -> tuple[str, list[tuple[str, float]]]:
        """Text, and each word with its confidence."""
        buf = (C.c_float * len(samples))(*samples)
        params = self.lib.parakeet_full_default_params(0)  # PARAKEET_SAMPLING_GREEDY
        params.n_threads = THREADS
        with self.lock:
            if self.lib.parakeet_full(self.ctx, params, buf, len(samples)) != 0:
                raise RuntimeError("parakeet_full failed")
            L, ctx = self.lib, self.ctx
            n = L.parakeet_full_n_segments(ctx)
            text = " ".join(L.parakeet_full_get_segment_text(ctx, i).decode("utf-8", "replace") for i in range(n))
            tokens = [(L.parakeet_full_get_token_text(ctx, i, j).decode("utf-8", "replace"),
                       L.parakeet_full_get_token_p(ctx, i, j))
                      for i in range(n) for j in range(L.parakeet_full_n_tokens(ctx, i))]
        return " ".join(text.split()), words(tokens)

    def transcribe(self, wav: bytes) -> tuple[str, list[tuple[str, float]]]:
        return self.transcribe_pcm(pcm_from_wav(wav))


def pcm_from_wav(wav: bytes) -> array:
    """16 kHz mono 16-bit WAV -> float samples in [-1, 1]."""
    try:
        with wave.open(io.BytesIO(wav)) as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
                raise ValueError(f"parakeet wants {RATE} Hz mono 16-bit, got "
                                 f"{w.getframerate()} Hz x{w.getnchannels()} {8 * w.getsampwidth()}-bit")
            ints = array("h", w.readframes(w.getnframes()))
    except (wave.Error, EOFError) as e:
        raise ValueError(f"not a WAV: {e}") from e
    return array("f", (s / 32768.0 for s in ints))


def words(tokens: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Word pieces -> (word, lowest piece confidence). "▁" starts a word; punctuation is ignored."""
    out: list[tuple[str, float]] = []
    for text, p in tokens:
        piece = "".join(c for c in text if c.isalnum())
        if not piece:
            continue
        if text.startswith("▁") or not out:
            out.append((piece, p))
        else:
            word, q = out[-1]
            out[-1] = (word + piece, min(p, q))
    return out


_engine: Parakeet | None = None
_failed = False
_loading = threading.Lock()


def engine() -> Parakeet | None:
    """The loaded model, or None if the library or model is missing (logged once)."""
    global _engine, _failed
    with _loading:
        if _engine is None and not _failed:
            try:
                if not MODEL.is_file():
                    raise FileNotFoundError(MODEL)
                _engine = Parakeet()
                _engine.transcribe_pcm(array("f", bytes(4 * RATE)))  # warm the GPU: the first run is ~0.3 s slower
            except (OSError, RuntimeError, AttributeError) as e:
                _failed = True
                log.warning("parakeet unavailable, using Whisper: %s", e)
    return _engine


def preload() -> None:
    """Load the model in the background (~3 s), so the first request doesn't wait for it."""
    if _engine is None and not _failed and not _loading.locked():
        threading.Thread(target=engine, name="parakeet-load", daemon=True).start()
