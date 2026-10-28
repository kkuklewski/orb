"""Per-turn latency: when each hop of a turn happened, so slow hops can be found and fixed.

Server marks (time.monotonic): audio (the last fragment arrived), stt (it was transcribed),
send (the hold ended and the request left the voice input), query (sent to Claude Code, after
connecting if needed), token (first streamed delta), spoken (first sentence ready for TTS),
clip (its audio ready), done (ResultMessage). The page adds the two ends the server can't see:
when the browser VAD ended the utterance and when the first audio started playing.
Each turn is logged at INFO and appended to ~/.orb/timing.jsonl.
"""

from __future__ import annotations

import json
import logging
import time

from . import config

log = logging.getLogger("orb.timing")

KEEP = 5000  # timing.jsonl keeps its newest lines (docs/adr/0014)
HOPS = (("stt", "audio", "stt"), ("hold", "stt", "send"), ("conn", "send", "query"), ("ttft", "query", "token"),
        ("say", "token", "spoken"), ("tts", "spoken", "clip"))


class TurnTiming:
    def __init__(self, turn: str, source: str, marks: dict[str, float] | None = None, model: str | None = None) -> None:
        self.turn = turn
        self.source = source
        self.model = model
        self.marks: dict[str, float] = dict(marks or {})
        self.extra: dict[str, int] = {}  # from the page: vad, net, total
        self.recorded = False

    def mark(self, name: str, at: float | None = None) -> bool:
        """Record a mark once; later calls for the same mark are ignored."""
        if name in self.marks:
            return False
        self.marks[name] = time.monotonic() if at is None else at
        return True

    def hops(self) -> dict[str, int]:
        m = self.marks
        out = {name: round((m[b] - m[a]) * 1000) for name, a, b in HOPS if a in m and b in m}
        start = m.get("audio", m.get("send"))
        if start is not None and "clip" in m:
            out["server"] = round((m["clip"] - start) * 1000)  # audio in (typed: sent) -> first clip out
        if "query" in m and "done" in m:
            out["turn"] = round((m["done"] - m["query"]) * 1000)
        return out

    def event(self) -> dict:
        return {"type": "timing", "turn": self.turn, "source": self.source, "model": self.model,
                "hops": {**self.hops(), **self.extra}}

    def line(self) -> str:
        return " · ".join(f"{k} {v / 1000:.1f}" for k, v in {**self.hops(), **self.extra}.items())

    def record(self, folder: str) -> None:
        log.info("timing %s [%s %s]: %s", folder, self.source, self.model or "?", self.line())
        try:
            config.append_private(config.STATE_DIR / "timing.jsonl", json.dumps(
                {"at": time.time(), "folder": folder, "turn": self.turn, "source": self.source, "model": self.model,
                 **self.hops(), **self.extra}) + "\n")
        except OSError as e:
            log.debug("timing.jsonl: %s", e)


def trim(path=None, keep: int = KEEP) -> None:
    """At start-up: rewrite timing.jsonl atomically with only its newest `keep` lines."""
    path = path or config.STATE_DIR / "timing.jsonl"
    try:
        lines = path.read_text().splitlines(keepends=True)
    except (OSError, ValueError):
        return
    if len(lines) > keep:
        config.write_private(path, "".join(lines[-keep:]))
