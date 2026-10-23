"""Open tasks ("- [ ]" lines) in the notes vault: read one in context, and change exactly that line.

Edits are one line at a time and only when the line still reads as the page last saw it (`expect`),
so a note that changed meanwhile (the user in Obsidian, a sync) is never overwritten. The markers are
the Obsidian Tasks plugin's: done "- [x] … ✅ 2026-10-23", not doing "- [-] … ❌ 2026-10-23",
snoozed "⏳ 2026-10-24" (hidden from Home until that day).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import tempfile
from pathlib import Path

from . import folders

CHECKBOX = re.compile(r"^(\s*[-*+] \[)(.)(\]\s+)(.*?)(\s*)$")
SNOOZE = re.compile(r"\s*⏳\s*(\d{4}-\d{2}-\d{2})")
CONTEXT = 6
TASK_INBOX = "inbox/Orb tasks.md"  # where "make it a task" appends, inside the notes folder


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


def snoozed_until(line: str) -> str | None:
    m = SNOOZE.search(line)
    return m.group(1) if m else None


def detail(vault: Path | None, file: str, line: int) -> dict:
    """{"type": "task_detail", …}: the task's line, the note's title, its heading and the lines around it."""
    p = note_path(vault, file)
    lines, _ = split_lines(p.read_text(encoding="utf-8", errors="replace"))
    if not 1 <= line <= len(lines) or not CHECKBOX.match(lines[line - 1]):
        raise TaskError("That task isn't on that line any more; the note changed.")
    title = next((x[2:].strip() for x in lines[:20] if x.startswith("# ")), p.stem)
    heading = next((x.lstrip("#").strip() for x in reversed(lines[:line - 1]) if x.startswith("#")), "")
    lo, hi = max(1, line - CONTEXT), min(len(lines), line + CONTEXT)
    return {"type": "task_detail", "file": file, "line": line, "raw": lines[line - 1], "title": title[:160],
            "heading": heading[:160], "mtime": p.stat().st_mtime,
            "context": [{"n": n, "text": lines[n - 1][:400]} for n in range(lo, hi + 1)]}


def changed_line(raw: str, action: str, today: dt.date, until: str | None = None) -> str:
    """The new text of a task line for one action."""
    m = CHECKBOX.match(raw)
    if not m:
        raise TaskError("That line isn't a task.")
    head, _, mid, text, _ = m.groups()
    text = SNOOZE.sub("", text).rstrip()
    if action == "done":
        return f"{head}x{mid}{text} ✅ {today.isoformat()}"
    if action == "drop":
        return f"{head}-{mid}{text} ❌ {today.isoformat()}"
    if action == "snooze":
        try:
            day = dt.date.fromisoformat(until or "")
        except ValueError:
            raise TaskError("Snooze needs a date.") from None
        if day <= today:
            raise TaskError("Snooze to a day after today.")
        return f"{head} {mid}{text} ⏳ {day.isoformat()}"
    raise TaskError(f"Unknown task action: {action}")


def apply(vault: Path | None, file: str, line: int, expect: str, new: str) -> None:
    """Replace one line, only if it still reads `expect`; atomic, keeps the note's line endings."""
    p = note_path(vault, file)
    data = p.read_bytes()
    lines, eol = split_lines(data.decode("utf-8"))
    if not 1 <= line <= len(lines) or lines[line - 1] != expect:
        raise TaskError("The note changed since Orb read it, so nothing was written. Open it again.")
    if not CHECKBOX.match(new) or "\n" in new or "\r" in new:
        raise TaskError("Orb only writes task lines.")
    lines[line - 1] = new
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".orb-", suffix=".md")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(eol.join(lines).encode("utf-8"))
        os.chmod(tmp, p.stat().st_mode & 0o777)
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def inbox_path(vault: Path | None) -> Path:
    """The inbox note inside the vault (not through a link, not in a hidden or skipped folder)."""
    if not vault:
        raise TaskError("No notes folder is set up.")
    root = vault.resolve()
    p = root / TASK_INBOX
    if p.parent.exists() and (p.parent.is_symlink() or p.is_symlink()):
        raise TaskError("The tasks inbox can't be a link.")
    if any(x.startswith(".") or x in folders.skip_names() for x in Path(TASK_INBOX).parts):
        raise TaskError("The tasks inbox is in a folder Orb doesn't use.")
    return p


def add_line(vault: Path | None, new: str) -> dict:
    """Append one "- [ ]" line to the inbox note (created with a heading if missing); atomic.
    {"type": "task_changed", "action": "add", …}; adding the same line twice is refused."""
    if not CHECKBOX.match(new) or "\n" in new or "\r" in new:
        raise TaskError("Orb only writes task lines.")
    p = inbox_path(vault)
    existing = p.read_text(encoding="utf-8") if p.is_file() else "# Orb tasks\n\n"
    lines, eol = split_lines(existing)
    if new in lines:
        raise TaskError("That task is already in your notes.")
    if lines and lines[-1] == "":
        lines.insert(len(lines) - 1, new)
        n = len(lines) - 1
    else:
        lines.append(new)
        n = len(lines)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".orb-", suffix=".md")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write((eol.join(lines) + ("" if lines[-1] == "" else eol)).encode("utf-8"))
        os.chmod(tmp, (p.stat().st_mode & 0o777) if p.exists() else 0o644)
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return {"type": "task_changed", "file": TASK_INBOX, "line": n, "action": "add", "raw": new, "previous": ""}


def delete_line(vault: Path | None, file: str, line: int, expect: str) -> None:
    """Remove one task line (Undo of "make it a task"), only if it still reads `expect`."""
    p = note_path(vault, file)
    lines, eol = split_lines(p.read_text(encoding="utf-8"))
    if not 1 <= line <= len(lines) or lines[line - 1] != expect or not CHECKBOX.match(expect):
        raise TaskError("The note changed since Orb read it, so nothing was removed. Open it again.")
    del lines[line - 1]
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".orb-", suffix=".md")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(eol.join(lines).encode("utf-8"))
        os.chmod(tmp, p.stat().st_mode & 0o777)
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def act(vault: Path | None, file: str, line: int, expect: str, action: str,
        until: str | None = None, value: str | None = None, today: dt.date | None = None) -> dict:
    """{"type": "task_changed", …}. "restore" (Undo) puts back `value`, a task line the page had."""
    if action == "delete":
        delete_line(vault, file, line, expect)
        return {"type": "task_changed", "file": file, "line": line, "action": "delete", "raw": "", "previous": expect}
    new = value if action == "restore" else changed_line(expect, action, today or dt.date.today(), until)
    if new is None:
        raise TaskError("Nothing to restore.")
    apply(vault, file, line, expect, new)
    return {"type": "task_changed", "file": file, "line": line, "action": action, "raw": new, "previous": expect}
