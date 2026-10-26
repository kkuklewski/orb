"""Open tasks ("- [ ]" lines) in the notes vault: read one in context, and change exactly that line.

Edits are one line at a time and only when the line still reads as the page last saw it (`expect`),
so a note that changed meanwhile (the user in Obsidian, a sync) is never overwritten. The markers are
the Obsidian Tasks plugin's: done "- [x] … ✅ 2026-10-23", not doing "- [-] … ❌ 2026-10-23",
snoozed "⏳ 2026-10-24" (hidden from Home until that day). Writing is vault_write's job.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from .vault_write import CHECKBOX, TaskError, note_path, set_task_line, split_lines

SNOOZE = re.compile(r"\s*⏳\s*(\d{4}-\d{2}-\d{2})")
CONTEXT = 6


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


def act(vault: Path | None, file: str, line: int, expect: str, action: str,
        until: str | None = None, value: str | None = None, today: dt.date | None = None) -> dict:
    """{"type": "task_changed", …}. "restore" (Undo) puts back `value`, a task line the page had. The write itself
    is the vault write module's (set_task_line)."""
    new = value if action == "restore" else changed_line(expect, action, today or dt.date.today(), until)
    if new is None:
        raise TaskError("Nothing to restore.")
    set_task_line(vault, file, line, expect, new)
    return {"type": "task_changed", "file": file, "line": line, "action": action, "raw": new, "previous": expect}
