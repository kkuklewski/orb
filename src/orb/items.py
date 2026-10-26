"""Item pages: one table and one detail page per source (tracker tasks, your open pull requests, repos with
unsaved work). A source only says which rows it has and what its prompt is; the page, the sorting, "Copy prompt"
and "Start in Orb" are the same for all. Pure and read-only (Archive is `tracker.set_done`); the server maps a
`repo_path` to an allowed folder and its label, so the page never names a path.
"""

from __future__ import annotations

import json
import re
import time
import shutil
import subprocess

from . import forget, home, tracker, triage
from .brief import quoted

SOURCES = ("vikunja", "prs", "repos", "notes", "tasks")
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
        got = tracker.source(cfg)
        repos = tracker.repo_map(cfg, vault) if got["tasks"] else {}
        mine = triage.current(got["tasks"], triage.load())
        rows = []
        for t in got["tasks"]:
            s_ = mine.get(t["id"])
            rows.append({"id": str(t["id"]), "title": t["title"], "repo_path": repos.get(t["project_id"]), "hot": t["priority"] >= 4,
                         "status": "ranked" if t["priority"] else "unranked",
                         "cells": {"project": t["project"], "due": t["due"] or "", "priority": str(t["priority"]), "created": t["created"],
                                   "suggested": str(s_["p"]) if s_ else "", "suggested_why": s_["why"] if s_ else ""}})
        return {"source": source, "kicker": tracker.name(cfg).upper(), "heading": "Tasks" if got["error"] else f"{got['total']} open tasks", "rows": rows,
                "columns": [_col("title", "Task", "title"), _col("project", "Project", "chip"), _col("repo", "Repo", "repo"), _col("due", "Due", "due"),
                            _col("priority", "Priority", "priority"), _col("suggested", "Suggested", "priority"), _col("created", "Created")],
                "group_key": "project", "can_archive": True, "can_suggest": True, "statuses": ["unranked", "ranked"],
                "url": got["url"], "url_label": f"OPEN {tracker.name(cfg).upper()} →" if got["url"] else None, "error": got["error"]}
    if source == "prs":
        prs = forget.prs()
        rows = [{"id": f"{p['repo']}#{p['number']}", "title": f"#{p['number']} · {p['title']}", "repo_path": _local(found, p["repo"]),
                 "hot": p["stale"], "cells": {"repository": p["repo"], "state": "draft" if p["draft"] else "",
                                              "idle": str(p["idle_days"])}} for p in prs]
        return {"source": source, "kicker": "GITHUB", "heading": f"{len(rows)} open pull requests", "rows": rows,
                "columns": [_col("title", "Pull request", "title"), _col("repo", "Local repo", "repo"), _col("repository", "Repository", "chip"), _col("state", "State"), _col("idle", "Idle", "age")],
                "group_key": "repository", "can_archive": False, "url": "https://github.com/pulls", "url_label": "OPEN GITHUB →"}
    if source == "repos":
        repos = forget.repos(found)
        rows = [{"id": r["path"], "title": r["label"], "repo_path": r["path"], "hot": bool(r["ahead"]),
                 "cells": {"branch": r.get("branch") or "", "unpushed": str(r["ahead"] or ""), "changed": str(r["changed"])}} for r in repos]
        return {"source": source, "kicker": "NOT SAVED YET", "heading": f"{len(rows)} repos with unsaved work", "rows": rows,
                "columns": [_col("title", "Repo", "title"), _col("branch", "Branch"), _col("unpushed", "Unpushed", "num"), _col("changed", "Changed", "num")],
                "group_key": None, "can_archive": False, "url": None, "url_label": None}
    if source == "notes":
        if not vault:
            raise ItemError("No notes folder is set.")
        now = time.time()
        pending = home.awaiting_notes(vault)
        judged = home.judged_notes(vault)
        rows = [{"id": n["file"], "title": n["title"], "repo_path": str(vault), "hot": False, "status": "pending",
                 "cells": {"kind": n["tag"], "verified": f"{n['verified']}%" if n["verified"] is not None else "",
                           "score": str(n["score"]) if n["score"] is not None else "", "lane": n["lane"], "why": n["why"],
                           "topic": n["topic"], "published": n["published"], "verdict": home.verdict_cell(vault, n),
                           "age": str(max(0, int((now - n["mtime"]) // 86400)))}} for n in pending]
        rows += [{"id": n["file"], "title": n["title"], "repo_path": str(vault), "hot": False, "status": "judged",
                  "cells": {"kind": "", "verified": "", "score": "", "lane": "", "why": "", "topic": n["topic"], "published": n["published"],
                            "verdict": home.verdict_cell(vault, n), "age": str(max(0, int((now - n["mtime"]) // 86400)))}} for n in judged]
        scored = sum(1 for n in pending if n["score"] is not None)
        heading = f"{len(pending)} notes wait for your verdict" + (", best first" if scored else "") + (f" · {len(judged)} judged in the last 14 days" if judged else "")
        return {"source": source, "kicker": "NOTES", "heading": heading, "rows": rows,
                "columns": [_col("title", "Note", "title"), _col("score", "Value", "num"), _col("lane", "Lane", "chip"), _col("why", "Why"), _col("topic", "Topic", "chip"),
                            _col("published", "Published"), _col("kind", "Kind", "chip"), _col("verified", "Verified", "num"), _col("verdict", "Verdict"), _col("age", "Age", "age")],
                "group_key": "topic", "can_archive": False, "can_judge": True, "statuses": ["pending", "judged"], "status_default": "pending", "url": None, "url_label": None}
    if source == "tasks":
        if not vault:
            raise ItemError("No notes folder is set.")
        now = time.time()
        found = home.open_tasks(vault)
        rows = [{"id": f"{t['file']}:{t['line']}", "title": t["text"], "repo_path": str(vault), "hot": False,
                 "cells": {"note": t["file"].rsplit("/", 1)[-1].removesuffix(".md"), "age": str(max(0, int((now - t["mtime"]) // 86400)))}} for t in found]
        return {"source": source, "kicker": "TO DO · FROM YOUR NOTES", "heading": f"{len(rows)} open tasks, newest first", "rows": rows,
                "columns": [_col("title", "Task", "title"), _col("note", "Note", "chip"), _col("age", "Age", "age")],
                "group_key": "note", "can_archive": False, "url": None, "url_label": None}
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
            t = tracker.task(cfg, int(item_id))
        except (*tracker.ERRORS, ValueError) as e:
            raise ItemError(str(e)) from e
        chips = [c for c in (t["project"], f"due {t['due']}" if t["due"] else "", "high priority" if t["priority"] >= 4 else "") if c]
        return {"title": t["title"], "kicker": tracker.name(cfg).upper(), "chips": chips, "body": t["description"], "url": t["url"],
                "url_label": f"Open in {tracker.name(cfg)} →", "brief": tracker.brief(cfg, t), "done": t["done"], "can_archive": True,
                "repo_path": tracker.repo_path(cfg, vault, t["project_id"])}
    if source == "prs":
        p = next((x for x in forget.prs() if f"{x['repo']}#{x['number']}" == item_id), None) if PR_ID.match(item_id) else None
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
        r = next(iter(forget.repos([f])), None) if f else None
        if r is None:
            raise ItemError("Nothing unsaved there any more.")
        facts = [f"{r['changed']} files changed (not committed)" if r["changed"] else "", f"{r['ahead']} commits not pushed" if r["ahead"] else "",
                 "no upstream branch" if r["ahead"] is None else ""]
        body = "\n".join(f"- {x}" for x in facts if x)
        return {"title": r["label"], "kicker": "NOT SAVED YET", "chips": [c for c in (r.get("branch") or "",) if c], "body": body,
                "url": None, "url_label": None, "done": False, "can_archive": False, "repo_path": r["path"],
                "brief": quoted("a repo with unsaved work", [("Repo", r["label"]), ("Branch", r.get("branch"))], body, ASK_UNSAVED)}
    if source == "notes":
        n = next((x for x in home.awaiting_notes(vault) if x["file"] == item_id), None) if vault else None
        if n is None:
            raise ItemError("That note isn't waiting for a verdict any more.")
        body = (vault / n["file"]).read_text(encoding="utf-8", errors="replace")
        ask = ("What I want: read the note and tell me in a few sentences what it says and what, if anything, I still need to "
               "do about it. Don't change the note.")
        chips = [n["tag"]] + ([f"{n['verified']}% verified"] if n["verified"] is not None else [])
        return {"title": n["title"], "kicker": "NOTES", "chips": chips, "body": body, "url": None, "url_label": None,
                "done": False, "can_archive": False, "repo_path": str(vault),
                "brief": quoted("a note in my notes folder", [("Note", n["file"]), ("Title", n["title"])], body, ask)}
    if source == "tasks":
        t = next((x for x in home.open_tasks(vault) if f"{x['file']}:{x['line']}" == item_id), None) if vault else None
        if t is None:
            raise ItemError("That task isn't open any more.")
        body = (vault / t["file"]).read_text(encoding="utf-8", errors="replace")
        ask = (f"What I want: read the note and help me do this task (line {t['line']}). Tell me the plan before you change anything.")
        return {"title": t["text"], "kicker": "TO DO · FROM YOUR NOTES", "chips": [t["file"]], "body": body, "url": None, "url_label": None,
                "done": False, "can_archive": False, "repo_path": str(vault),
                "brief": quoted("an open task in my notes", [("Task", t["text"]), ("Note", t["file"])], body, ask)}
    raise ItemError(f"Unknown item: {source}")
