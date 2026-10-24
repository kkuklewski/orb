"""Split Claude's streamed answer into what she says and what the chat shows.

The model opens each answer with `<spoken>…</spoken>`: a 1–3 sentence gist. That part streams
to TTS sentence by sentence and is shown as a small "said aloud" line; the written answer after
it continues without repeating it.
Text blocks without the tag fall back to speaking only the prose before the first heading,
list, table or code block, at most three sentences. Code, lists and tables never reach TTS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

OPEN = "<spoken>"
CLOSE = "</spoken>"
FALLBACK_MAX_SENTENCES = 3

VOICE_PROMPT = """\
# Voice (Orb)
The user is talking to you by voice through Orb, a local voice app. Your answers are shown in full as
Markdown in a chat window, and a short part of them is read aloud.

Start every answer, and every later text block in which you report to the user, with a short
spoken summary inside <spoken>…</spoken>: 1–3 plain sentences that give the gist and context, in the
same language as the user. Keep its first sentence short, at most about 8 words, so speech can
start at once ("Yes, it's fixed." / "Two plus two is four."). Never put code, commands, file paths, URLs, lists, tables or step
details inside <spoken>; say where they are instead ("I put the three steps in the chat").
After </spoken>, continue with the written part. The page shows the spoken summary right above
it, so the written part must not repeat or restate it, not even in other words: no recap, no
"What happened:" opener. Go straight to what the summary left out: details, steps, commands, code,
paths, numbers. For a short answer the summary is the whole answer: write nothing after </spoken>.
Brief progress notes between tool calls need no <spoken> part.

When a flow, architecture, sequence, state machine or comparison is clearer as a picture, add a
fenced block whose opening line is exactly ```mermaid (never a bare ```) to the written part (flowchart, sequenceDiagram, stateDiagram-v2, erDiagram…); the
page draws it. Keep it small (under about 12 nodes), use short plain labels with no HTML, and never
mention the diagram inside <spoken>.
"""

_ABBREVIATIONS = ("e.g.", "i.e.", "etc.", "vs.", "mr.", "mrs.", "dr.", "np.", "tj.", "tzn.", "m.in.", "ok.")
_SENTENCE_END = re.compile(r"""[.!?…]+["'”’)\]]*\s+""")
_STRUCT = re.compile(r"(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~|-{3,}\s*$|\*{3,}\s*$)")
_STRUCT_PREFIX = re.compile(r"(#{1,6}|[-*+]|\d+[.)]?|`{1,2}|~{1,2}|-{1,2}|\*{1,2})")
_FENCE = re.compile(r"\s*(```|~~~)")
_READABLE = re.compile(r"\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)")
_URL = re.compile(r"(https?://|www\.)\S+")
_PATH = re.compile(
    r"(?<![\w/])(?:~|\.{1,2})?/[\w.@%+~-]+(?:/[\w.@%+~-]*)*"  # absolute, ~/ and ./ paths
    r"|(?<![\w/])[\w.@-]+(?:/[\w.@-]+){2,}"  # a/b/c
    r"|(?<![\w/])[\w.@-]+/[\w@-]+\.\w{1,5}\b"  # dir/file.ext
)
_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_CODE = re.compile(r"`+([^`]*)`+")
_EMPH = re.compile(r"(\*\*|__|\*|_)(?=\S)(.+?)(?<=\S)\1")


def clean_for_speech(text: str) -> str:
    """Turn a sentence of Markdown into plain speakable text."""
    text = _LINK.sub(r"\1", text)
    text = _URL.sub("", text)
    text = _CODE.sub(lambda m: "" if "/" in m.group(1) else m.group(1), text)
    text = _EMPH.sub(r"\2", text)
    text = _PATH.sub("", text)
    text = text.replace("`", "").replace("<", " ").replace(">", " ")
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text if re.search(r"\w", text) else ""


class SentenceSplitter:
    """Cut streamed prose at sentence ends."""

    def __init__(self) -> None:
        self.buf = ""

    def feed(self, text: str) -> list[str]:
        self.buf += text
        out: list[str] = []
        start = 0
        for m in _SENTENCE_END.finditer(self.buf):
            candidate = self.buf[start : m.end()].strip()
            last_word = candidate.rsplit(None, 1)[-1].lower() if candidate else ""
            if last_word in _ABBREVIATIONS:
                continue
            out.append(candidate)
            start = m.end()
        self.buf = self.buf[start:]
        return out

    def flush(self) -> list[str]:
        rest, self.buf = self.buf.strip(), ""
        return [rest] if rest else []


class SpeechFilter:
    """Line-aware filter from streamed Markdown to spoken sentences.

    on_structure="stop": the first heading, list, table or code block ends speech (fallback).
    on_structure="skip": such lines are skipped, prose around them is spoken (<spoken> part).
    on_structure="read": headings and list items are read, code and tables skipped (Read all).
    """

    def __init__(self, on_structure: str = "skip", max_sentences: int | None = None) -> None:
        self.on_structure = on_structure
        self.max_sentences = max_sentences
        self.splitter = SentenceSplitter()
        self.line = ""  # current, incomplete line
        self.line_class: str | None = None  # "prose" | "struct" | "skip" | None (undecided)
        self.fed = 0  # chars of self.line already given to the splitter
        self.in_fence = False
        self.stopped = False
        self.count = 0

    def feed(self, text: str) -> list[str]:
        out: list[str] = []
        while text and not self.stopped:
            nl = text.find("\n")
            if nl < 0:
                self.line += text
                out += self._progress(complete=False)
                break
            self.line += text[:nl]
            text = text[nl + 1 :]
            out += self._progress(complete=True)
            out += self._end_line()
        return self._limit(out)

    def flush(self) -> list[str]:
        out = self._progress(complete=True) if self.line else []
        if not self.stopped:
            out += self._clean(self.splitter.flush())
        self.line, self.line_class, self.fed = "", None, 0
        return self._limit(out)

    def _limit(self, sentences: list[str]) -> list[str]:
        if self.max_sentences is None:
            return sentences
        room = self.max_sentences - self.count
        sentences = sentences[: max(room, 0)]
        self.count += len(sentences)
        if self.count >= self.max_sentences:
            self.stopped = True
        return sentences

    def _clean(self, sentences: list[str]) -> list[str]:
        return [c for c in (clean_for_speech(s) for s in sentences) if c]

    def _classify(self, complete: bool) -> str | None:
        stripped = self.line.lstrip()
        if self.in_fence:
            return "fence"
        if not stripped:
            return "blank" if complete else None
        if _FENCE.match(self.line):
            return "fence"
        if _STRUCT.match(stripped):
            return "struct"
        if not complete and _STRUCT_PREFIX.fullmatch(stripped):
            return None  # could still become a list marker or heading
        return "prose"

    def _progress(self, complete: bool) -> list[str]:
        if self.stopped:
            return []
        out: list[str] = []
        if self.line_class is None:
            cls = self._classify(complete)
            if cls is None:
                return []
            if cls in ("struct", "fence"):
                # Structure ends the paragraph that came before it.
                out = self._clean(self.splitter.flush())
                if self.on_structure == "stop":
                    self.stopped = True
                    return out
                cls = "skip" if cls == "struct" else cls
                if self.on_structure == "read" and (m := _READABLE.match(self.line)):
                    cls, self.fed = "readable", m.end()
            self.line_class = cls
        if self.line_class in ("prose", "readable"):
            new = self.line[self.fed :]
            self.fed = len(self.line)
            out += self._clean(self.splitter.feed(new))
        return out

    def _end_line(self) -> list[str]:
        out: list[str] = []
        if self.line_class == "fence":
            self.in_fence = not self.in_fence if _FENCE.match(self.line) else self.in_fence
        elif self.line_class == "blank":
            out = self._clean(self.splitter.flush())
        elif self.line_class == "readable":
            out = self._clean(self.splitter.feed(" ") + self.splitter.flush())
        elif self.line_class == "prose":
            out = self._clean(self.splitter.feed(" "))
        self.line, self.line_class, self.fed = "", None, 0
        return out


@dataclass
class Routed:
    display: str = ""  # the written answer, for the chat
    speech: list[str] = field(default_factory=list)  # sentences for TTS
    said: str = ""  # the <spoken> part, shown as a muted "said aloud" line

    def __iadd__(self, other: "Routed") -> "Routed":
        self.display += other.display
        self.speech += other.speech
        self.said += other.said
        return self


class TurnState:
    """Shared across the text blocks of one answer: once a <spoken> part was seen, untagged
    blocks are not spoken (they are progress notes between tool calls)."""

    def __init__(self) -> None:
        self.tag_seen = False


class TextBlockRouter:
    """Route one streamed text block: display text without tags, spoken sentences."""

    def __init__(self, turn: TurnState | None = None) -> None:
        self.turn = turn or TurnState()
        self.pending = ""  # held back: might be the start of a tag
        self.inside = False
        self.mode: str | None = None  # "tag" | "fallback" | None (undecided)
        self.pre = ""  # outside text seen before the mode was decided
        self.spoken = SpeechFilter("skip")
        self.fallback = SpeechFilter("stop", FALLBACK_MAX_SENTENCES)

    def feed(self, delta: str) -> Routed:
        out = Routed()
        self.pending += delta
        while self.pending:
            lt = self.pending.find("<")
            if lt < 0:
                out += self._text(self.pending)
                self.pending = ""
                break
            if lt:
                out += self._text(self.pending[:lt])
                self.pending = self.pending[lt:]
            for tag in (OPEN, CLOSE):
                if self.pending.startswith(tag):
                    out += self._tag(tag)
                    self.pending = self.pending[len(tag) :]
                    break
            else:
                if OPEN.startswith(self.pending) or CLOSE.startswith(self.pending):
                    break  # wait for the rest of a possible tag
                out += self._text("<")
                self.pending = self.pending[1:]
        return out

    def finish(self) -> Routed:
        out = Routed()
        if self.pending:
            out += self._text(self.pending)
            self.pending = ""
        if self.mode is None:
            self._decide(fallback=True)
            if self.pre:
                out.speech += self._fallback_feed(self.pre)
        out.speech += self.spoken.flush()
        if self.mode == "fallback" and not self.turn.tag_seen:
            out.speech += self.fallback.flush()
        return out

    def _decide(self, fallback: bool) -> None:
        self.mode = "fallback" if fallback else "tag"

    def _tag(self, tag: str) -> Routed:
        out = Routed()
        if self.mode is None:
            self._decide(fallback=bool(self.pre.strip()))
            if self.mode == "fallback":
                out.speech += self._fallback_feed(self.pre)
        if tag == OPEN:
            self.inside = True
            self.turn.tag_seen = True
        else:
            self.inside = False
            out.speech += self.spoken.flush()
            out.said += " "
        return out

    def _text(self, text: str) -> Routed:
        if self.inside:
            return Routed(said=text, speech=self.spoken.feed(text))
        out = Routed(display=text)
        if self.mode is None:
            self.pre += text
            if self.pre.strip() and not OPEN.startswith(self.pre.lstrip()):
                self._decide(fallback=True)
                out.speech += self._fallback_feed(self.pre)
        elif self.mode == "fallback":
            out.speech += self._fallback_feed(text)
        return out

    def _fallback_feed(self, text: str) -> list[str]:
        if self.turn.tag_seen:
            return []
        return self.fallback.feed(text)


def strip_spoken_tags(text: str) -> str:
    """Plain text of a whole stored answer, tags removed."""
    return text.replace(OPEN, "").replace(CLOSE, "\n\n")


_SPOKEN_PART = re.compile(re.escape(OPEN) + r"(.*?)(?:" + re.escape(CLOSE) + r"|$)", re.S)


def split_spoken(text: str) -> tuple[str, str]:
    """(said, written) of a whole stored answer."""
    said = " ".join(m.strip() for m in _SPOKEN_PART.findall(text))
    return said, _SPOKEN_PART.sub("", text).strip()


def read_all_sentences(markdown: str) -> list[str]:
    """Everything speakable in an answer: prose, headings and list items; no code or tables."""
    f = SpeechFilter("read")
    return f.feed(strip_spoken_tags(markdown) + "\n") + f.flush()


def route_whole(text: str) -> Routed:
    """Route a complete text block at once (used for tests and history)."""
    r = TextBlockRouter()
    out = r.feed(text)
    out += r.finish()
    return out
