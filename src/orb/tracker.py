"""The task tracker behind Tasks, Home's queue, delegations and "Make it a task" (ADR 0010): Vikunja (`vikunja.py`) or
Jira Cloud (`jira.py`). Jira when a Jira address is set (settings "jira_url" or ORB_JIRA_URL), else Vikunja. Both give
the same task shape and the same writes; callers pass the settings dict and never name the backend.

Internal keys stay as they were ("vikunja:<id>" on Home, the item source "vikunja"): they name the Tasks source, not
the product.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import ModuleType

from . import jira, vikunja

ERRORS = (vikunja.VikunjaError, jira.JiraError)  # `except tracker.ERRORS` catches either backend's refusal
NOT_FOUND = (vikunja.VikunjaNotFound, jira.JiraNotFound)  # the backend answered 404: catch it before ERRORS
home_event = vikunja.home_event
KEY = re.compile(r"[A-Za-z][A-Za-z0-9_]*-\d+")  # a Jira issue key (ACME-12); the task's title starts with it


def _jira(cfg: dict) -> bool:
    return jira.wanted(cfg.get("jira_url") or "")


def _b(cfg: dict) -> tuple[ModuleType, str]:
    """(backend module, its address setting); looked up per call, so tests can swap a backend's functions."""
    return (jira, cfg.get("jira_url") or "") if _jira(cfg) else (vikunja, cfg.get("vikunja_url") or "")


def name(cfg: dict) -> str:
    return "Jira" if _jira(cfg) else "Vikunja"


def unset(cfg: dict) -> str:
    """What is missing, in the owner's words."""
    return ("Jira isn't set up (jira_url, ORB_JIRA_EMAIL and ORB_JIRA_TOKEN)." if _jira(cfg)
            else "Vikunja isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN).")


def wanted(cfg: dict) -> bool:
    """An address is set: the owner wants the Tasks source, so a missing token is an error to show."""
    m, url = _b(cfg)
    return m.wanted(url)


def configured(cfg: dict) -> bool:
    m, url = _b(cfg)
    return m.configured(url) is not None


def open_tasks(cfg: dict, project: str | None = None) -> dict:
    m, url = _b(cfg)
    return _held(cfg, m.open_tasks(url, project))


def held_by(task: dict, me: dict) -> str | None:
    """The teammate holding `task` (the first assignee who isn't `me`, by name), or None when it is free or only mine."""
    other = [a for a in task.get("assignees") or [] if a["id"] != me["id"]]
    return (other[0]["name"] or "a teammate") if other else None


def _held(cfg: dict, got: dict) -> dict:
    """Each row gets "held_by" (#866 Q7): a teammate's name, else None. me() is asked only when a row has an assignee;
    when the tracker can't say who Orb is, nothing reads as held (Delegate refuses on its own then)."""
    rows = got.get("tasks") or []
    who = None
    if any(t.get("assignees") for t in rows):
        try:
            who = me(cfg)
        except ERRORS:
            pass
    for t in rows:
        t["held_by"] = held_by(t, who) if who else None
    return got


def me(cfg: dict) -> dict:
    """Who Orb is in the tracker: {"id", "name", "username"}, from the token it already has (ADR 0010). Raises ERRORS
    when the tracker can't say; a task's "assignees" use the same ids."""
    m, url = _b(cfg)
    return m.me(url)


def by_key(tasks: list[dict], key: str) -> dict | None:
    """The open task whose title starts with this issue key (ACME-12), else None."""
    want = key.strip().upper() + " "
    return next((t for t in tasks if str(t["title"]).upper().startswith(want)), None)


def source(cfg: dict) -> dict:
    m, url = _b(cfg)
    return _held(cfg, m.source(url))


def task(cfg: dict, task_id: int) -> dict:
    m, url = _b(cfg)
    return m.task(url, task_id)


def set_done(cfg: dict, task_id: int, done: bool) -> None:
    m, url = _b(cfg)
    m.set_done(url, task_id, done)


def set_priority(cfg: dict, task_id: int, priority: int) -> None:
    m, url = _b(cfg)
    m.set_priority(url, task_id, priority)


def set_due(cfg: dict, task_id: int, day: str) -> None:
    m, url = _b(cfg)
    m.set_due(url, task_id, day)


def repo_map(cfg: dict, vault: Path | None) -> dict[int, str]:
    """Project id -> local repo path, from the vault's projects/*.md (`vikunja_project` or `jira_project`)."""
    return jira.repo_map(cfg.get("jira_url") or "", vault) if _jira(cfg) else vikunja.repo_map(vault)


def repo_path(cfg: dict, vault: Path | None, project_id: int) -> str | None:
    return jira.repo_path(cfg.get("jira_url") or "", vault, project_id) if _jira(cfg) else vikunja.repo_path(vault, project_id)


def project_for(cfg: dict, vault: Path | None, repo: str | None, inbox: str) -> tuple[int, str]:
    m, url = _b(cfg)
    return m.project_for(url, vault, repo, inbox)


def create(cfg: dict, project_id: int, title: str, description: str = "") -> dict:
    m, url = _b(cfg)
    return m.create(url, project_id, title, description)


def delete(cfg: dict, task_id: int) -> None:
    m, url = _b(cfg)
    m.delete(url, task_id)


def brief(cfg: dict, t: dict) -> str:
    return vikunja.brief(t, name(cfg))
