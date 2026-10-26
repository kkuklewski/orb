"""The only place Orb's own code writes to the notes vault (ADR 0007). Three operations, nothing else:

1. a note's verdict fields: `human_verdict` (approve | reject) and `verdict_at`; "restore" removes them and
   `owner_read`, so the note waits again;
2. a note's `owner_read` (the owner opened the note itself and left it without a verdict);
3. one note-task line's marker and date: done "- [x] … ✅ <day>", not doing "- [-] … ❌ <day>", snooze "⏳ <day>".

Every write is compare-and-apply: it happens only if the field or line still reads as the page saw it, otherwise
nothing is written ("The note changed since Orb read it"). Writes are atomic and keep the note's line endings.
Orb commits nothing: the vault's git stays the owner's.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import tempfile
from pathlib import Path

from . import folders

CHECKBOX = re.compile(r"^(\s*[-*+] \[)(.)(\]\s+)(.*?)(\s*)$")
DATES = re.compile(r"\s*[✅❌⏳]\s*\d{4}-\d{2}-\d{2}")  # the dates a marker change adds or removes
MARKERS = (" ", "x", "-")
VERDICTS = ("approve", "reject", "restore")
MAX_NOTES = 200
CHANGED = "The note changed since Orb read it, so nothing was written. Open it again."
_FIELD = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$")
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


class TaskError(Exception):
    """Refused: shown to the user as is."""


def note_path(vault: Path | None, file: str) -> Path:
    """`file` (relative to the vault) as a real path inside it; never outside, hidden or skipped."""
    if not vault:
        raise TaskError("No notes folder is set up.")
    root = vault.resolve()
    p = (root / file).resolve()
    if root not in p.parents or p.suffix != ".md" or not p.is_file():
        raise TaskError("That note isn't in your notes folder.")
    parts = p.relative_to(root).parts
    if any(x.startswith(".") or x in folders.skip_names() for x in parts):
        raise TaskError("That note isn't in your notes folder.")
    return p


def split_lines(text: str) -> tuple[list[str], str]:
    """The note's lines and its line ending, numbered the same way everywhere (1 = first line)."""
    eol = "\r\n" if "\r\n" in text else "\n"
    return text.split(eol), eol


def verdict_seen(verdict: str | None, at: str | None) -> str:
    """How a note's verdict reads on the page and in the compare step: "" (none) or "reject 2026-10-24"."""
    if not verdict:
        return ""
    m = _DAY.search(at or "")
    return f"{verdict} {m.group(0) if m else ''}".strip()


def _write(p: Path, lines: list[str], eol: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".orb-", suffix=".md")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(eol.join(lines).encode("utf-8"))
        os.chmod(tmp, p.stat().st_mode & 0o777)
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _read(p: Path) -> tuple[list[str], str]:
    return split_lines(p.read_bytes().decode("utf-8"))


def _front_end(lines: list[str]) -> int | None:
    """The index of the frontmatter's closing "---", None when the note has no frontmatter."""
    if not lines or lines[0].strip() != "---":
        return None
    return next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)


def _fields(lines: list[str], end: int) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines[1:end]:
        m = _FIELD.match(line)
        if m:
            out[m.group(1)] = m.group(2).strip("\"'")
    return out


def _with_fields(lines: list[str], end: int, drop: tuple[str, ...], add: list[str]) -> list[str]:
    head = [l for l in lines[1:end] if not l.startswith(tuple(f"{k}:" for k in drop))]
    return [lines[0], *head, *add, *lines[end:]]


def set_verdict(vault: Path | None, seen: dict[str, str], verdict: str, today: dt.date | None = None) -> int:
    """Write `verdict` into each note of `seen` (file -> its verdict as the page showed it, see verdict_seen).
    Every note is checked before the first write; one refusal writes nothing. Returns how many changed."""
    if verdict not in VERDICTS:
        raise TaskError("Unknown verdict.")
    if not seen or len(seen) > MAX_NOTES:
        raise TaskError(f"Pick between 1 and {MAX_NOTES} notes.")
    day = (today or dt.date.today()).isoformat()
    planned: list[tuple[Path, list[str], str]] = []
    for f, was in seen.items():
        p = note_path(vault, f)
        lines, eol = _read(p)
        end = _front_end(lines)
        if end is None:
            raise TaskError(f"{f} has no frontmatter, so nothing was written.")
        fm = _fields(lines, end)
        if verdict_seen(fm.get("human_verdict"), fm.get("verdict_at")) != was:
            raise TaskError(f"The note changed since Orb read it, so nothing was written: {f}. Open the list again.")
        if verdict == "restore":
            new = _with_fields(lines, end, ("human_verdict", "verdict_at", "owner_read"), [])
        else:
            new = _with_fields(lines, end, ("human_verdict", "verdict_at"), [f"human_verdict: {verdict}", f"verdict_at: '{day}'"])
        planned.append((p, new, eol))
    for p, new, eol in planned:
        _write(p, new, eol)
    return len(planned)


def set_verdicts(vault: Path | None, notes: list[dict], today: dt.date | None = None) -> tuple[list[dict], list[dict]]:
    """Each note's own verdict (`{file, seen, verdict}`), written one by one through set_verdict: a refusal keeps that
    note as it was and doesn't stop the others. Returns (applied `{file, verdict}`, refused `{file, reason}`)."""
    if not notes or len(notes) > MAX_NOTES:
        raise TaskError(f"Pick between 1 and {MAX_NOTES} notes.")
    applied: list[dict] = []
    refused: list[dict] = []
    for n in notes:
        f = str(n["file"])
        try:
            set_verdict(vault, {f: str(n.get("seen") or "")}, n["verdict"], today)
            applied.append({"file": f, "verdict": n["verdict"]})
        except TaskError as e:
            refused.append({"file": f, "reason": str(e)})
        except (OSError, UnicodeDecodeError) as e:
            refused.append({"file": f, "reason": f"Couldn't change the note: {e}"})
    return applied, refused


def set_owner_read(vault: Path | None, file: str, seen: str, today: dt.date | None = None) -> None:
    """Mark a note read (`owner_read: '<day>'`), only if its owner_read still reads `seen` ("" = not set)."""
    p = note_path(vault, file)
    lines, eol = _read(p)
    end = _front_end(lines)
    if end is None:
        raise TaskError(f"{file} has no frontmatter, so nothing was written.")
    if _fields(lines, end).get("owner_read", "") != seen:
        raise TaskError(CHANGED)
    _write(p, _with_fields(lines, end, ("owner_read",), [f"owner_read: '{(today or dt.date.today()).isoformat()}'"]), eol)


def _task_parts(line: str) -> tuple[str, str, str, str] | None:
    """(indent and bullet, marker, gap, text without its dates) of a task line; None when it isn't one."""
    m = CHECKBOX.match(line)
    if not m or "\n" in line or "\r" in line:
        return None
    head, mark, mid, text, _ = m.groups()
    return head, mark, mid, DATES.sub("", text).rstrip()


def set_task_line(vault: Path | None, file: str, line: int, expect: str, new: str) -> None:
    """Replace one task line, only if it still reads `expect` and `new` differs from it only in the marker and
    the done / not doing / snooze dates."""
    p = note_path(vault, file)
    lines, eol = _read(p)
    if not 1 <= line <= len(lines) or lines[line - 1] != expect:
        raise TaskError(CHANGED)
    was, now = _task_parts(expect), _task_parts(new)
    if not was or not now:
        raise TaskError("Orb only writes task lines.")
    if now[1] not in MARKERS or (was[0], was[2], was[3]) != (now[0], now[2], now[3]):
        raise TaskError("Orb only changes a task's marker and date.")
    lines[line - 1] = new
    _write(p, lines, eol)
