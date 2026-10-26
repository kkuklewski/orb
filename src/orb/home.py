"""The home screen's notes part: open tasks ("- [ ]" checkboxes) and recently changed notes from the
notes vault. Read-only, local, no model call; folders in folders.skip_names() are never entered."""

from __future__ import annotations

import datetime as dt
import os
import re
import time
from pathlib import Path

from . import folders, suggest
from .tasks import SNOOZE, snoozed_until, split_lines
from .vault_write import note_path, verdict_seen

TASK = re.compile(r"^\s*[-*+] \[ \]\s+(.+?)\s*$")
_WIKI = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]")  # [[note|shown]] or [[note]] -> the shown text
_EMPH = re.compile(r"\*\*|__")


MAX_FILE_BYTES = 512 * 1024
MAX_FILES = 5000
WEEK = 7 * 86400


def _plain(task: str) -> str:
    return _EMPH.sub("", _WIKI.sub(r"\1", SNOOZE.sub("", task))).strip()


def _notes(vault: Path) -> list[tuple[Path, float]]:
    """Markdown files under the vault with their mtimes, newest first; hidden and skipped folders left out."""
    skip = folders.skip_names()
    out: list[tuple[Path, float]] = []
    for root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
        for f in files:
            if f.endswith(".md"):
                p = Path(root, f)
                try:
                    st = p.stat()
                except OSError:
                    continue
                if st.st_size <= MAX_FILE_BYTES:
                    out.append((p, st.st_mtime))
        if len(out) >= MAX_FILES:
            break
    return sorted(out, key=lambda x: x[1], reverse=True)


def _title(path: Path) -> str:
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if line.startswith("# "):
                    return line[2:].strip()
                if i > 20:
                    break
    except OSError:
        pass
    return path.stem


_FM_CACHE: dict[Path, tuple[float, dict[str, str]]] = {}
FM_LINES = 40


def _front(path: Path, mtime: float) -> dict[str, str]:
    """Top-level "key: value" pairs of a note's frontmatter (first lines only), cached by mtime. Lists and
    nested values are kept as raw text; quotes are stripped."""
    hit = _FM_CACHE.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    fm: dict[str, str] = {}
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            if fh.readline().strip() == "---":
                for i, line in enumerate(fh):
                    if line.strip() == "---" or i >= FM_LINES:
                        break
                    m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
                    if m:
                        fm[m.group(1)] = m.group(2).strip("\"'")
    except OSError:
        pass
    _FM_CACHE[path] = (mtime, fm)
    return fm


def _score(raw: str | None) -> int | None:
    """`value_score` as an int 0..10 (the vault's value rubric), None when missing or not a number."""
    try:
        n = int(float(raw or ""))
    except ValueError:
        return None
    return n if 0 <= n <= 10 else None


def _out(fm: dict[str, str]) -> bool:
    """Vetoed, dismissed, expired (`auto_archived`) notes and review stubs: never listed as waiting."""
    return (fm.get("kind") == "review" or fm.get("status") == "vetoed" or fm.get("rag_dismissed", "").lower() == "true"
            or bool(fm.get("auto_archived")))


def _waiting(fm: dict[str, str]) -> bool:
    """The note waits for the owner's verdict (see _awaiting)."""
    if not fm or _out(fm):
        return False
    ai = fm.get("curated_by") == "ai"
    return ((ai and fm.get("human_reviewed", "").lower() == "false")
            or (bool(fm.get("fact_checked_at")) and not fm.get("human_verdict"))
            or (_score(fm.get("value_score")) is not None and not ai and not fm.get("human_verdict") and not fm.get("promoted_to")))


def _tag(fm: dict[str, str]) -> str:
    """The note's kind as a row shows it."""
    ai = fm.get("curated_by") == "ai"
    return "unverified view" if fm.get("knowledge_tier") == "perspective" else "AI" if ai else "your note" if fm.get("written_by") == "owner" else "capture"


def _lane(fm: dict[str, str]) -> str:
    return fm.get("value_lane", "") if fm.get("value_lane") in ("news", "learning") else ""


def _awaiting(vault: Path, files: list[tuple[Path, float]], limit: int | None) -> tuple[list[dict], int]:
    """Notes that wait for the owner: fact-checked with no human_verdict, AI-curated and not yet reviewed, or
    scored by the nightly run (`value_score`) and not judged. Vetoed, dismissed, expired (`auto_archived`) and
    review stubs are left out. Best first: highest `value_score`, unscored last, newest first within a score.
    Returns (the first `limit`, None = all; total)."""
    out: list[dict] = []
    for p, t in files:
        fm = _front(p, t)
        if not _waiting(fm):
            continue
        score = _score(fm.get("value_score"))
        tag = _tag(fm)
        try:
            verified = round(float(fm["verification_rate"]) * 100) if fm.get("verification_rate") else None
        except ValueError:
            verified = None
        out.append({"title": _title(p)[:120], "file": str(p.relative_to(vault)), "mtime": t, "tag": tag,
                    "verified": verified if verified is None or 0 <= verified <= 100 else None,
                    "published": _day(fm.get("published")), "topic": fm.get("cluster", ""),
                    "score": score, "why": fm.get("value_why", "")[:200], "lane": _lane(fm)})
    out.sort(key=lambda n: (-(n["score"] if n["score"] is not None else -1), -n["mtime"]))
    return (out if limit is None else out[:limit]), len(out)


def _day(raw: str | None) -> str:
    """The date part (YYYY-MM-DD) of a frontmatter timestamp, "" when it isn't one."""
    m = re.match(r"\d{4}-\d{2}-\d{2}", raw or "")
    return m.group(0) if m else ""


def verdict_cell(vault: Path, n: dict) -> str:
    """A listed note's verdict as the Notes list shows it, and as the page sends it back for the compare step."""
    fm = _front(vault / n["file"], n["mtime"])
    return verdict_seen(fm.get("human_verdict"), fm.get("verdict_at"))


def judged_notes(vault: Path, days: int = 14, today: dt.date | None = None) -> list[dict]:
    """Notes the owner gave a verdict in the last `days` days (newest first), so a bulk reject can be undone. An old
    "defer" (no longer offered) still lists, so it can be restored."""
    since = ((today or dt.date.today()) - dt.timedelta(days=days)).isoformat()
    out: list[dict] = []
    for p, t in _notes(vault):
        fm = _front(p, t)
        at = _day(fm.get("verdict_at"))
        if fm.get("human_verdict") in ("approve", "reject", "defer") and at >= since and fm.get("kind") != "review":
            out.append({"title": _title(p)[:120], "file": str(p.relative_to(vault)), "mtime": t, "verdict": fm["human_verdict"],
                        "verdict_at": at, "published": _day(fm.get("published")), "topic": fm.get("cluster", "")})
    return sorted(out, key=lambda n: n["verdict_at"], reverse=True)


def awaiting_notes(vault: Path) -> list[dict]:
    """Every note that waits for the owner's verdict, best first (the Notes page)."""
    return _awaiting(vault, _notes(vault), None)[0]


BRAIN_MAX = 300
BODY_MAX = 100_000


def _brain_row(vault: Path, p: Path, t: float, fm: dict[str, str], limits: tuple[int, int]) -> dict:
    score, waiting = _score(fm.get("value_score")), _waiting(fm)
    return {"file": str(p.relative_to(vault)), "title": _title(p)[:120], "kind": _tag(fm), "mtime": t,
            "score": score, "lane": _lane(fm), "why": fm.get("value_why", "")[:200],
            "waiting": waiting, "verdict": verdict_seen(fm.get("human_verdict"), fm.get("verdict_at")),
            "owner_read": fm.get("owner_read", ""), "suggest": suggest.note(score, limits) if waiting else ""}


def brain_notes(vault: Path, limit: int = BRAIN_MAX) -> list[dict]:
    """Brain's list: the newest notes (files with frontmatter), each with its kind, value score and whether it waits
    for a verdict, with its suggested verdict (suggest.note). Review stubs, vetoed, dismissed and expired notes are left
    out; a rejected note stays (Restore)."""
    out: list[dict] = []
    limits = suggest.thresholds(vault)
    for p, t in _notes(vault):
        fm = _front(p, t)
        if fm and not _out(fm):
            out.append(_brain_row(vault, p, t, fm, limits))
            if len(out) >= limit:
                break
    return out


def brain_note(vault: Path | None, file: str) -> dict:
    """One note for its page: the row's fields and the body under the frontmatter (cut at BODY_MAX characters)."""
    p = note_path(vault, file)
    assert vault is not None  # note_path refused otherwise
    t = p.stat().st_mtime
    fm = _front(p, t)
    lines, _ = split_lines(p.read_bytes().decode("utf-8", errors="replace"))
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
        lines = lines[end + 1:]
    body = "\n".join(lines).strip()
    return {**_brain_row(vault.resolve(), p, t, fm, suggest.thresholds(vault)), "body": body[:BODY_MAX]}


def _tasks(vault: Path, files: list[tuple[Path, float]], limit: int, today: str = "") -> tuple[list[dict], int, int]:
    """The first `limit` open tasks (newest notes first, so the freshest lead), how many are open, and how
    many are snoozed past `today` (those are left out). `raw` is the exact line, for edits."""
    found: list[dict] = []
    total = snoozed = 0
    for path, mtime in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for n, line in enumerate(split_lines(text)[0], 1):
            m = TASK.match(line)
            if not m:
                continue
            until = snoozed_until(line)
            if until and until > today:
                snoozed += 1
                continue
            total += 1
            if len(found) < limit:
                found.append({"text": _plain(m.group(1))[:200], "file": str(path.relative_to(vault)), "line": n,
                              "mtime": mtime, "raw": line})
    return found, total, snoozed


def open_tasks(vault: Path) -> list[dict]:
    """Every open task in the notes (snoozed ones left out), newest notes first: the Home card's "All" list."""
    return _tasks(vault, _notes(vault), 10**9, dt.date.today().isoformat())[0]


def summary(vault: Path | None, tasks: int = 40, notes: int = 6, now: float | None = None) -> dict:
    """{"type": "home", ...}: what the home screen shows about the notes (empty without a vault)."""
    if not vault or not vault.is_dir():
        return {"type": "home", "vault": "", "tasks": [], "open_tasks": 0, "snoozed": 0, "notes": [], "notes_week": 0, "awaiting": [], "awaiting_count": 0}
    now = time.time() if now is None else now
    files = _notes(vault)
    found, total, snoozed = _tasks(vault, files, tasks, dt.date.fromtimestamp(now).isoformat())
    recent = [{"title": _title(p)[:120], "file": str(p.relative_to(vault)), "mtime": t} for p, t in files[:notes]]
    waiting, waiting_total = _awaiting(vault, files, 6)
    return {"type": "home", "vault": str(vault), "tasks": found, "open_tasks": total, "snoozed": snoozed, "notes": recent,
            "notes_week": sum(1 for _, t in files if now - t < WEEK), "awaiting": waiting, "awaiting_count": waiting_total}


def vault_info(vault: Path | None) -> dict | None:
    """For the setup's notes step: how many notes and open tasks the folder holds."""
    if not vault:
        return None
    if not vault.is_dir():
        return {"path": str(vault), "exists": False, "notes": 0, "open_tasks": 0}
    files = _notes(vault)
    return {"path": str(vault), "exists": True, "notes": len(files), "open_tasks": _tasks(vault, files, 0, dt.date.today().isoformat())[1]}
