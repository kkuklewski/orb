"""The home screen's notes part: open tasks ("- [ ]" checkboxes) and recently changed notes from the
notes vault. Read-only, local, no model call; folders in folders.skip_names() are never entered."""

from __future__ import annotations

import datetime as dt
import os
import re
import time
from pathlib import Path

from . import folders
from .tasks import SNOOZE, snoozed_until, split_lines

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


def _awaiting(vault: Path, files: list[tuple[Path, float]], limit: int | None) -> tuple[list[dict], int]:
    """Notes that wait for the owner's verdict: fact-checked with no human_verdict, or AI-curated and not yet
    reviewed. Vetoed, dismissed and review stubs are left out. Returns (newest `limit`, None = all; total)."""
    out: list[dict] = []
    total = 0
    for p, t in files:
        fm = _front(p, t)
        if not fm or fm.get("kind") == "review" or fm.get("status") == "vetoed" or fm.get("rag_dismissed", "").lower() == "true":
            continue
        ai = fm.get("curated_by") == "ai"
        waiting = (ai and fm.get("human_reviewed", "").lower() == "false") or (bool(fm.get("fact_checked_at")) and not fm.get("human_verdict"))
        if not waiting:
            continue
        total += 1
        if limit is None or len(out) < limit:
            tag = "unverified view" if fm.get("knowledge_tier") == "perspective" else "AI" if ai else "your note" if fm.get("written_by") == "owner" else "capture"
            try:
                verified = round(float(fm["verification_rate"]) * 100) if fm.get("verification_rate") else None
            except ValueError:
                verified = None
            out.append({"title": _title(p)[:120], "file": str(p.relative_to(vault)), "mtime": t, "tag": tag,
                        "verified": verified if verified is None or 0 <= verified <= 100 else None})
    return out, total


def awaiting_notes(vault: Path) -> list[dict]:
    """Every note that waits for the owner's verdict, newest first (the Notes page)."""
    return _awaiting(vault, _notes(vault), None)[0]


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
