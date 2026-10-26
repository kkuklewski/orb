"""Triage suggestions come from plain rules, never a model (docs/adr/0006). The word is a hint beside a task on Home's
Up next; tapping it does the matching action (Start, Delegate with its grant card, Later). Nothing is ever suggested
as Done or Drop, and reminders, results and pull requests get none.

- Vikunja task: overdue or due within WEEK days -> take now; else a known repo -> delegate; else later.
- Note task: overdue or due within WEEK days (the line's 📅 date) -> take now; else later. Never delegate.
- Note waiting for a verdict: value_score at or above the rubric's top threshold -> approve, at or below its bottom
  one -> reject, in between or unscored -> none (the owner reads it). The thresholds come from the vault's value
  rubric (`skills/value.md`, its "Thresholds:" line), 4 and 8 when it doesn't parse. Brain groups its list by it.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from . import folders

TAKE_NOW, DELEGATE, LATER = "take now", "delegate", "later"
WEEK = 7  # days ahead that still count as "due this week" (the Tasks page's "this week" uses the same)
_DUE = re.compile(r"📅\s*(\d{4}-\d{2}-\d{2})")
APPROVE, REJECT = "approve", "reject"
RUBRIC = "skills/value.md"
THRESHOLDS = (4, 8)  # (reject at or below, approve at or above) when the rubric doesn't say
_AT_MOST = re.compile(r"(?:≤|<=)\s*\**\s*(\d+)")
_AT_LEAST = re.compile(r"(?:≥|>=)\s*\**\s*(\d+)")


def _soon(due: str | None, today: str) -> bool:
    try:
        return bool(due) and dt.date.fromisoformat(due[:10]) <= dt.date.fromisoformat(today) + dt.timedelta(days=WEEK)
    except ValueError:
        return False


def note_due(line: str) -> str | None:
    """The 📅 date on a note task's line, if it has one."""
    m = _DUE.search(line)
    return m.group(1) if m else None


def task(due: str | None, repo: str | None, today: str) -> str:
    """A Vikunja task's suggestion; `repo` is its project's repo from the repo map (None when there is none)."""
    return TAKE_NOW if _soon(due, today) else DELEGATE if repo else LATER


def note_task(line: str, today: str) -> str:
    """A note task's suggestion from its line (the 📅 date, if any)."""
    return TAKE_NOW if _soon(note_due(line), today) else LATER


def thresholds(vault: Path | None) -> tuple[int, int]:
    """(reject at or below, approve at or above) from the rubric's "Thresholds:" line, e.g. "**≥ 8** read today ·
    **5–7** worth a look · **≤ 4** skip"; THRESHOLDS when the file or the line is missing or doesn't make sense."""
    try:
        text = (vault / RUBRIC).read_text(encoding="utf-8") if vault and folders.inside(vault, vault / RUBRIC) else ""
    except (OSError, UnicodeDecodeError):
        return THRESHOLDS
    for line in text.splitlines():
        if line.lstrip("*_ ").lower().startswith("thresholds"):
            low, high = _AT_MOST.search(line), _AT_LEAST.search(line)
            if low and high and 0 <= int(low.group(1)) < int(high.group(1)) <= 10:
                return int(low.group(1)), int(high.group(1))
            break
    return THRESHOLDS


def note(score: int | None, limits: tuple[int, int] = THRESHOLDS) -> str:
    """A waiting note's suggested verdict from its value_score: "approve", "reject" or "" (none: read it)."""
    if score is None:
        return ""
    return APPROVE if score >= limits[1] else REJECT if score <= limits[0] else ""
