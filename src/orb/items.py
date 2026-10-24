"""Item pages: one table and one detail page per source (Vikunja tasks, your open pull requests, repos with
unsaved work). A source only says which rows it has and what its prompt is; the page, the sorting, "Copy prompt"
and "Start in Orb" are the same for all. Pure and read-only (Archive is `vikunja.set_done`); the server maps a
`repo_path` to an allowed folder and its label, so the page never names a path.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess

from . import vikunja, watch
from .brief import quoted

SOURCES = ("vikunja", "prs", "repos")
GH_TIMEOUT = 12
PR_ID = re.compile(r"^[\w.-]+/[\w.-]+#\d+$")
ASK_UNSAVED = ("Show me what's uncommitted or not pushed in this repo, and propose how to commit it "
               "(grouped into sensible commits). Don't commit or push until I say so.")


class ItemError(Exception):
    pass


def _col(key: str, label: str, kind: str = "text") -> dict:
    return {"key": key, "label": label, "kind": kind}


def _local(found: list[dict], label: str) -> str | None:
    return next((f["path"] for f in found if f["label"] == label), None)


def list_(source: str, cfg: dict, vault, found: list[dict]) -> dict:
    """{kicker, heading, columns, rows, ...}: rows carry `repo_path` (or None) for the server to resolve."""
    if source == "vikunja":
        try:
            got = vikunja.open_tasks(cfg.get("vikunja_url") or "")
        except vikunja.VikunjaError as e:
            raise ItemError(str(e)) from e
        repos = vikunja.repo_map(vault)
        rows = [{"id": str(t["id"]), "title": t["title"], "repo_path": repos.get(t["project_id"]), "hot": t["priority"] >= 4,
                 "cells": {"project": t["project"], "due": t["due"] or "", "priority": str(t["priority"])}} for t in got["tasks"]]
        return {"source": source, "kicker": "VIKUNJA", "heading": f"{got['total']} open tasks", "rows": rows,
                "columns": [_col("title", "Task", "title"), _col("repo", "Repo", "repo"), _col("project", "Project", "chip"), _col("due", "Due", "due"), _col("priority", "Priority", "priority")],
                "group_key": "repo", "can_archive": True, "url": got["url"], "url_label": "OPEN VIKUNJA →"}
    if source == "prs":
        prs = watch.prs()
        rows = [{"id": f"{p['repo']}#{p['number']}", "title": f"#{p['number']} · {p['title']}", "repo_path": _local(found, p["repo"]),
                 "hot": p["stale"], "cells": {"repository": p["repo"], "state": "draft" if p["draft"] else "",
                                              "idle": str(p["idle_days"])}} for p in prs]
        return {"source": source, "kicker": "GITHUB", "heading": f"{len(rows)} open pull requests", "rows": rows,
                "columns": [_col("title", "Pull request", "title"), _col("repo", "Local repo", "repo"), _col("repository", "Repository", "chip"), _col("state", "State"), _col("idle", "Idle", "age")],
                "group_key": "repository", "can_archive": False, "url": "https://github.com/pulls", "url_label": "OPEN GITHUB →"}
    if source == "repos":
        repos = watch.repos(found)
        rows = [{"id": r["path"], "title": r["label"], "repo_path": r["path"], "hot": bool(r["ahead"]),
                 "cells": {"branch": r.get("branch") or "", "unpushed": str(r["ahead"] or ""), "changed": str(r["changed"])}} for r in repos]
        return {"source": source, "kicker": "NOT SAVED YET", "heading": f"{len(rows)} repos with unsaved work", "rows": rows,
                "columns": [_col("title", "Repo", "title"), _col("branch", "Branch"), _col("unpushed", "Unpushed", "num"), _col("changed", "Changed", "num")],
                "group_key": None, "can_archive": False, "url": None, "url_label": None}
    raise ItemError(f"Unknown list: {source}")


def _pr_body(repo: str, number: str) -> str:
    gh = shutil.which("gh")
    if not gh:
        return ""
    try:
        r = subprocess.run([gh, "pr", "view", number, "-R", repo, "--json", "body"], capture_output=True, text=True, timeout=GH_TIMEOUT)
        return str(json.loads(r.stdout or "{}").get("body") or "") if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return ""


def get(source: str, item_id: str, cfg: dict, vault, found: list[dict]) -> dict:
    """{title, kicker, chips, body, url, url_label, brief, done, can_archive, repo_path} for one item."""
    if source == "vikunja":
        try:
            t = vikunja.task(cfg.get("vikunja_url") or "", int(item_id))
        except (vikunja.VikunjaError, ValueError) as e:
            raise ItemError(str(e)) from e
        chips = [c for c in (t["project"], f"due {t['due']}" if t["due"] else "", "high priority" if t["priority"] >= 4 else "") if c]
        return {"title": t["title"], "kicker": "VIKUNJA", "chips": chips, "body": t["description"], "url": t["url"],
                "url_label": "Open in Vikunja →", "brief": vikunja.brief(t), "done": t["done"], "can_archive": True,
                "repo_path": vikunja.repo_path(vault, t["project_id"])}
    if source == "prs":
        p = next((x for x in watch.prs() if f"{x['repo']}#{x['number']}" == item_id), None) if PR_ID.match(item_id) else None
        if p is None:
            raise ItemError("That pull request isn't open any more, or isn't yours.")
        body = _pr_body(p["repo"], str(p["number"]))
        chips = [p["repo"], f"no activity for {p['idle_days']} days"] + (["draft"] if p["draft"] else [])
        ask = ("What I want: read the pull request and the branch in the repo, then tell me what is left to merge it, "
               "or why it went quiet. Don't change anything until I agree.")
        return {"title": f"#{p['number']} · {p['title']}", "kicker": "GITHUB", "chips": chips, "body": body, "url": p["url"],
                "url_label": "Open on GitHub →", "done": False, "can_archive": False, "repo_path": _local(found, p["repo"]),
                "brief": quoted("one of my open pull requests (GitHub)", [("Repository", p["repo"]), ("Pull request", p["title"]), ("Link", p["url"])], body, ask)}
    if source == "repos":
        f = next((x for x in found if x["path"] == item_id), None)
        r = next(iter(watch.repos([f])), None) if f else None
        if r is None:
            raise ItemError("Nothing unsaved there any more.")
        facts = [f"{r['changed']} files changed (not committed)" if r["changed"] else "", f"{r['ahead']} commits not pushed" if r["ahead"] else "",
                 "no upstream branch" if r["ahead"] is None else ""]
        body = "\n".join(f"- {x}" for x in facts if x)
        return {"title": r["label"], "kicker": "NOT SAVED YET", "chips": [c for c in (r.get("branch") or "",) if c], "body": body,
                "url": None, "url_label": None, "done": False, "can_archive": False, "repo_path": r["path"],
                "brief": quoted("a repo with unsaved work", [("Repo", r["label"]), ("Branch", r.get("branch"))], body, ASK_UNSAVED)}
    raise ItemError(f"Unknown item: {source}")
