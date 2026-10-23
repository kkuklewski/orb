"""The home screen's notes part: open tasks ("- [ ]" checkboxes) and recently changed notes from the
notes vault. Read-only, local, no model call; folders in folders.skip_names() are never entered."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

from . import folders

TASK = re.compile(r"^\s*[-*+] \[ \]\s+(.+?)\s*$")
_WIKI = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]")  # [[note|shown]] or [[note]] -> the shown text
_EMPH = re.compile(r"\*\*|__")


def _plain(task: str) -> str:
    return _EMPH.sub("", _WIKI.sub(r"\1", task)).strip()
MAX_FILE_BYTES = 512 * 1024
MAX_FILES = 5000
WEEK = 7 * 86400


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


def _tasks(vault: Path, files: list[tuple[Path, float]], limit: int) -> tuple[list[dict], int]:
    """The first `limit` open tasks (newest notes first, so the freshest lead) and how many there are."""
    found: list[dict] = []
    total = 0
    for path, mtime in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            m = TASK.match(line)
            if m:
                total += 1
                if len(found) < limit:
                    found.append({"text": _plain(m.group(1))[:200], "file": str(path.relative_to(vault)), "line": n, "mtime": mtime})
    return found, total


def summary(vault: Path | None, tasks: int = 12, notes: int = 6, now: float | None = None) -> dict:
    """{"type": "home", ...}: what the home screen shows about the notes (empty without a vault)."""
    if not vault or not vault.is_dir():
        return {"type": "home", "vault": "", "tasks": [], "open_tasks": 0, "notes": [], "notes_week": 0}
    now = time.time() if now is None else now
    files = _notes(vault)
    found, total = _tasks(vault, files, tasks)
    recent = [{"title": _title(p)[:120], "file": str(p.relative_to(vault)), "mtime": t} for p, t in files[:notes]]
    return {"type": "home", "vault": str(vault), "tasks": found, "open_tasks": total, "notes": recent,
            "notes_week": sum(1 for _, t in files if now - t < WEEK)}


def vault_info(vault: Path | None) -> dict | None:
    """For the setup's notes step: how many notes and open tasks the folder holds."""
    if not vault:
        return None
    if not vault.is_dir():
        return {"path": str(vault), "exists": False, "notes": 0, "open_tasks": 0}
    files = _notes(vault)
    return {"path": str(vault), "exists": True, "notes": len(files), "open_tasks": _tasks(vault, files, 0)[1]}
