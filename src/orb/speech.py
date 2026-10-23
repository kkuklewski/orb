"""Speech to text (Parakeet in-process, Whisper as fallback) and Kokoro (text to speech) over HTTP."""

from __future__ import annotations

import asyncio
import logging
import re
import time
import unicodedata
from difflib import SequenceMatcher

import httpx

from . import config, parakeet, settings

log = logging.getLogger("orb.speech")

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=3))
    return _client


PROMPT = ""  # Whisper vocabulary (vocab.build_prompt), set by the server


_SOUND = str.maketrans({"w": "v", "c": "k", "q": "k", "y": "j", "z": "s", "ł": "l"})


def _letters(s: str) -> str:
    """Rough sound key: no diacritics or punctuation, look-alike letters merged, no doubles."""
    s = unicodedata.normalize("NFKD", s.casefold().translate(_SOUND))
    s = "".join(c for c in s if c.isalnum())
    return "".join(c for i, c in enumerate(s) if i == 0 or c != s[i - 1])


def names() -> dict[str, str]:
    """Sound key -> spelling of the vocabulary names worth a Whisper retry (from PROMPT; very short
    ones like "n8n" match too much)."""
    out = {}
    for w in (w.strip() for w in PROMPT.split(",")):
        if len(key := _letters(w)) >= 4:
            out.setdefault(key, w)
    return out


NAME_MATCH = 0.6  # misheard names score >= 0.67 on the sound key; ordinary words <= 0.5


def sounds_like_name(words: list[tuple[str, float]], vocab: dict[str, str] | list[str]) -> str | None:
    """The first unsure word (alone or joined with a neighbour: "Ker's Medi", "co Olify") that is
    close to a vocabulary name, Polish endings included ("Vikunji", "Obsidiana")."""
    raw = [w for w, _ in words]
    for i, (word, p) in enumerate(words):
        if p >= parakeet.MIN_P or _letters(word) in vocab:
            continue  # sure, or the name itself heard right ("Obsidian" at low confidence)
        cands = [word]
        if i > 0:
            cands.append(raw[i - 1] + word)
        if i + 1 < len(raw):
            cands.append(word + raw[i + 1])
        for c in map(_letters, cands):
            for name in vocab:
                if len(c) >= 3 and SequenceMatcher(None, c, name).ratio() >= NAME_MATCH:
                    return f"{c}~{name}"
    return None


def respell(text: str, words: list[tuple[str, float]], vocab: dict[str, str]) -> str:
    """Names Parakeet heard right but spelled its own way: "TailScale" -> "Tailscale"."""
    for word, _ in words:
        name = vocab.get(_letters(word))
        if name and word != name:
            text = re.sub(rf"\b{re.escape(word)}\b", name, text)
    return text


def engine_choice() -> str:
    return settings.settings["stt"]


async def transcribe(wav: bytes) -> str:
    """Parakeet first (~0.07 s); Whisper with the vocabulary when an unsure word may be a name."""
    engine = await asyncio.to_thread(parakeet.engine) if engine_choice() == "parakeet" else None  # may load (~3 s)
    if engine is not None:
        try:
            text, words = await asyncio.to_thread(engine.transcribe, wav)
        except (RuntimeError, ValueError) as e:
            log.warning("parakeet failed, using Whisper: %s", e)
        else:
            unsure = [f"{w}:{p:.2f}" for w, p in words if p < parakeet.MIN_P]
            vocab = names()
            hit = sounds_like_name(words, vocab)
            if hit is None:
                if unsure:
                    log.info("parakeet kept %r (unsure %s, no name)", text, " ".join(unsure))
                return respell(text, words, vocab)
            log.info("parakeet %r: %s may be a name (unsure %s), asking Whisper", text, hit, " ".join(unsure))
    return await transcribe_whisper(wav)


async def transcribe_whisper(wav: bytes) -> str:
    data = {"model": "whisper-1", "response_format": "json"}
    if PROMPT:
        data["prompt"] = PROMPT  # whisper.cpp server: initial prompt
    r = await client().post(
        config.WHISPER_URL,
        files={"file": ("utterance.wav", wav, "audio/wav")},
        data=data,
    )
    r.raise_for_status()
    return " ".join(r.json().get("text", "").split())


CHATTERBOX = "chatterbox"  # the voice name that picks Chatterbox instead of a Kokoro voice
# Kokoro voices worth offering, best first, with the grade from Kokoro's own VOICES.md (hexgrad/Kokoro-82M).
# Everything below C+ there (af_sky C-, am_adam F+, ...) sounds noticeably worse, so it isn't listed.
RECOMMENDED = (
    ("af_heart", "Heart", "US · female", "A"), ("af_bella", "Bella", "US · female", "A-"),
    ("af_nicole", "Nicole", "US · female, soft", "B-"), ("bf_emma", "Emma", "UK · female", "B-"),
    ("am_michael", "Michael", "US · male", "C+"), ("am_fenrir", "Fenrir", "US · male", "C+"),
    ("am_puck", "Puck", "US · male", "C+"), ("af_sarah", "Sarah", "US · female", "C+"),
    ("af_kore", "Kore", "US · female", "C+"), ("af_aoede", "Aoede", "US · female", "C+"),
)


def tts_error(e: Exception) -> str:
    """A short, readable reason a voice sample failed."""
    if isinstance(e, httpx.HTTPStatusError):
        return f"Kokoro refused that voice (HTTP {e.response.status_code}). It may not be installed."
    if isinstance(e, httpx.ConnectError):
        return f"Kokoro isn't running ({config.KOKORO_URL.split('/v1/')[0]}). Start it, or pick Browser for her voice."
    if isinstance(e, httpx.TimeoutException):
        return "Kokoro took too long to answer. Try again in a moment."
    return f"Kokoro failed: {type(e).__name__}"


def recommended(installed: list[str], current: str | None = None) -> list[dict]:
    """The recommended voices this Kokoro has, plus the current one if it isn't among them."""
    have = set(installed)
    out = [{"id": v, "name": n, "desc": d, "grade": g} for v, n, d, g in RECOMMENDED if v in have]
    if current and current not in {x["id"] for x in out}:
        out.append({"id": current, "name": current, "desc": "your current voice", "grade": None})
    return out
_POLISH = re.compile(r"[ąćęłńóśźż]|\b(nie|jest|się|że|tak|dobra|mam|już|czy|jak|co)\b", re.I)


async def synthesize(text: str, voice: str | None = None) -> bytes:
    if (voice or settings.settings["voice"]) == CHATTERBOX:
        r = await client().post(config.CHATTERBOX_URL, timeout=120,
                                json={"input": text, "language": "pl" if _POLISH.search(text) else "en"})
        r.raise_for_status()
        return r.content  # WAV; the page decodes by content, not by the mime label
    r = await client().post(
        config.KOKORO_URL,
        json={"model": "kokoro", "voice": voice or settings.settings["voice"], "input": text, "response_format": "mp3"},
    )
    r.raise_for_status()
    return r.content


WARM_EVERY = 60.0
_last_warm = float("-inf")
_warm_tasks: set[asyncio.Task] = set()


def warm_tts() -> None:
    """The user started talking: wake Kokoro so the first spoken sentence is quick (cold after a pause
    it takes ~0.7 s, warm ~0.2 s). At most once a minute, never awaited, errors ignored."""
    global _last_warm
    now = time.monotonic()
    if now - _last_warm < WARM_EVERY or settings.settings["voice"] == CHATTERBOX or settings.settings["tts"] == "browser":
        return
    _last_warm = now

    async def run() -> None:
        try:
            await synthesize("Hi.")
        except Exception as e:  # noqa: BLE001 - a warm-up must never break a turn
            log.debug("kokoro warm-up failed: %s", e)

    task = asyncio.get_running_loop().create_task(run())
    _warm_tasks.add(task)  # keep a reference until it finishes
    task.add_done_callback(_warm_tasks.discard)


async def health() -> dict[str, bool]:
    if engine_choice() == "parakeet":
        parakeet.preload()  # a page is connecting: have the model ready before the first request
    out = {}
    for name, url in (("whisper", config.WHISPER_URL), ("kokoro", config.KOKORO_URL)):
        base = url.split("/v1/")[0]
        try:
            r = await client().get(base + "/health", timeout=2)
            out[name] = r.status_code == 200
        except httpx.HTTPError:
            out[name] = False
    return out


async def voices() -> list[str]:
    try:
        r = await client().get(config.KOKORO_URL.split("/v1/")[0] + "/v1/audio/voices", timeout=3)
        data = r.json()
        found = list(data.get("voices", data) if isinstance(data, dict) else data)
    except (httpx.HTTPError, ValueError):
        found = []
    try:
        r = await client().get(config.CHATTERBOX_URL.split("/v1/")[0] + "/health", timeout=1)
        if r.status_code == 200:
            found.append(CHATTERBOX)
    except httpx.HTTPError:
        pass
    return found
