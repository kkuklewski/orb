"""Don't forget, the pane in Home's status card for things that wait quietly: reminders not yet due and pinned links
from settings, repos with uncommitted or unpushed work, and your open pull requests. Vikunja tasks are the Tasks
source (`vikunja.source`), not part of this pane. Read-only; local except `gh` (GitHub's own CLI, signed in by the
user); no model call."""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SOON_DAYS = 30  # dated reminders show from this many days ahead
STALE_DAYS = 3  # a pull request untouched this long is "going stale"
GIT_TIMEOUT = 4
GH_TIMEOUT = 12
PR_CACHE_SECONDS = 300
# A repo's own .git/config can name programs for `git status` to run (fsmonitor, filter drivers, also in
# submodules); the check never runs one. Filters from the user's global config (git-lfs) stay.
GIT_SAFE = ("-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null")

_prs: dict = {"at": 0.0, "items": []}


def _date(raw: object) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def reminders(items: list, today: dt.date) -> list[dict]:
    """Dated ones due within SOON_DAYS (overdue first), then the undated ones in their order."""
    dated, undated = [], []
    for x in items if isinstance(items, list) else []:
        if not isinstance(x, dict) or not str(x.get("text") or "").strip():
            continue
        row = {"text": str(x["text"]).strip()[:200], "due": None, "days": None,
               "url": x["url"] if str(x.get("url") or "").startswith(("http://", "https://")) else None}
        due = _date(x.get("due")) if x.get("due") else None
        if due is None:
            undated.append(row)
        elif (days := (due - today).days) <= SOON_DAYS:
            dated.append(row | {"due": due.isoformat(), "days": days})
    return sorted(dated, key=lambda r: r["days"]) + undated


def links(items: list) -> list[dict]:
    return [{"label": str(x.get("label") or x["url"])[:80], "url": x["url"]}
            for x in (items if isinstance(items, list) else [])
            if isinstance(x, dict) and str(x.get("url") or "").startswith(("http://", "https://"))]


def parse_status(out: str) -> dict:
    """`git status --porcelain=v1 -b`: branch, files changed, commits ahead of the upstream (None = no upstream) and
    behind it (as of the last fetch)."""
    lines = out.splitlines()
    head = lines[0][3:] if lines and lines[0].startswith("## ") else ""
    branch, _, rest = head.partition("...")
    ahead: int | None = None
    behind = 0
    if rest:
        ahead = 0
        if "[" in rest and "ahead " in rest:
            ahead = int(rest.split("ahead ", 1)[1].split("]")[0].split(",")[0])
        if "[" in rest and "behind " in rest:
            behind = int(rest.split("behind ", 1)[1].split("]")[0])
    if branch.startswith("No commits yet on "):
        branch = branch.removeprefix("No commits yet on ")
    return {"branch": branch.split(" ")[0] or None, "changed": sum(1 for x in lines[1:] if x.strip()), "ahead": ahead,
            "behind": behind}


def repo_filters(out: str) -> list[str]:
    """`git config -z --show-scope --get-regexp ^filter\\.`: the filter commands set in the repo itself."""
    keys = []
    parts = out.split("\0")
    for scope, entry in zip(parts[0::2], parts[1::2]):
        key = entry.split("\n", 1)[0]
        if scope in ("local", "worktree") and key.startswith("filter.") and key.rsplit(".", 1)[-1] in ("clean", "smudge", "process"):
            keys.append(key)
    return keys


def blank_env(keys: list[str]) -> dict[str, str]:
    """GIT_CONFIG_* overrides that set each key to "": key and value stay apart (a "-c k=v" splits at the first "=")."""
    env = {"GIT_CONFIG_COUNT": str(len(keys))}
    for i, k in enumerate(keys):
        env |= {f"GIT_CONFIG_KEY_{i}": k, f"GIT_CONFIG_VALUE_{i}": ""}
    return env


def _repo(f: dict) -> dict | None:
    try:
        c = subprocess.run(["git", "-C", f["path"], "config", "-z", "--show-scope", "--includes", "--get-regexp", r"^filter\."],
                           capture_output=True, text=True, timeout=GIT_TIMEOUT)
        if c.returncode not in (0, 1) or (c.returncode == 1 and c.stdout):  # 1 = no filters; anything else: don't guess
            return None
        r = subprocess.run(["git", "-C", f["path"], *GIT_SAFE, "status", "--porcelain=v1", "-b", "--ignore-submodules=all"],
                           capture_output=True, text=True, timeout=GIT_TIMEOUT,
                           env=os.environ | blank_env(repo_filters(c.stdout)))
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    s = parse_status(r.stdout)
    if not s["changed"] and not s["ahead"]:
        return None
    return {"path": f["path"], "label": f["label"], **s}


def repos(found: list[dict]) -> list[dict]:
    """Repos (from the folder scan) with uncommitted files or unpushed commits, most changed first."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [r for r in pool.map(_repo, [f for f in found if Path(f["path"], ".git").exists()]) if r]
    return sorted(rows, key=lambda r: (-(r["ahead"] or 0), -r["changed"]))


def parse_prs(raw: str, now: float) -> list[dict]:
    out = []
    for p in json.loads(raw or "[]"):
        try:
            updated = dt.datetime.fromisoformat(p["updatedAt"].replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError):
            continue
        idle = int((now - updated) // 86400)
        out.append({"repo": (p.get("repository") or {}).get("nameWithOwner", ""), "number": int(p.get("number", 0)),
                    "title": str(p.get("title", ""))[:200], "url": p.get("url", ""), "updated": updated,
                    "idle_days": idle, "stale": idle >= STALE_DAYS, "draft": bool(p.get("isDraft"))})
    return sorted(out, key=lambda p: p["updated"])


def prs(now: float | None = None) -> list[dict]:
    """Your open pull requests (gh search, cached a few minutes), oldest activity first; [] without gh."""
    now = time.time() if now is None else now
    if now - _prs["at"] < PR_CACHE_SECONDS:
        return _prs["items"]
    gh = shutil.which("gh")
    items: list[dict] = []
    if gh:
        try:
            r = subprocess.run([gh, "search", "prs", "--author=@me", "--state=open", "--limit", "30",
                                "--json", "number,title,repository,url,updatedAt,isDraft"],
                               capture_output=True, text=True, timeout=GH_TIMEOUT)
            if r.returncode == 0:
                items = parse_prs(r.stdout, now)
        except (OSError, subprocess.TimeoutExpired, ValueError):
            pass
    _prs.update(at=now, items=items)
    return items


def due_now(cfg: dict, today: dt.date | None = None) -> list[dict]:
    """Reminders dated today or earlier: they need you (needs.py), so the pane leaves them out."""
    return [r for r in reminders(cfg.get("reminders") or [], today or dt.date.today()) if r["days"] is not None and r["days"] <= 0]


def summary(cfg: dict, found: list[dict], today: dt.date | None = None) -> dict:
    """{"type": "home_forget", ...}: the Don't forget pane (reminders still ahead or undated) and the pinned links."""
    today = today or dt.date.today()
    later = [r for r in reminders(cfg.get("reminders") or [], today) if r["days"] is None or r["days"] > 0]
    return {"type": "home_forget", "reminders": later,
            "links": links(cfg.get("links") or []), "repos": repos(found), "prs": prs()}
