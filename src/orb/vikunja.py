"""Open tasks from a Vikunja task tracker, for the home screen. Read-only.

The address comes from settings ("vikunja_url") or ORB_VIKUNJA_URL; the API token only from the
environment (ORB_VIKUNJA_TOKEN), so it never lands in settings.json. Without both, Orb uses the
"- [ ]" tasks in the notes instead.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.parse
import urllib.request

from . import config

PER_PAGE = 100
MAX_PAGES = 3
TIMEOUT = 6
NO_DATE = "0001-01-01"  # Vikunja's "no due date"


class VikunjaError(Exception):
    pass


def configured(url: str) -> tuple[str, str] | None:
    """(base url, token) when both are set."""
    base = (url or config.env("VIKUNJA_URL", "")).strip().rstrip("/")
    token = config.env("VIKUNJA_TOKEN", "").strip()
    return (base, token) if base.startswith(("http://", "https://")) and token else None


def _get(base: str, token: str, path: str, params: dict) -> list[dict]:
    req = urllib.request.Request(f"{base}/api/v1{path}?{urllib.parse.urlencode(params)}",
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.load(r)
    except (OSError, ValueError) as e:
        raise VikunjaError(f"Vikunja didn't answer: {e}") from e
    return data if isinstance(data, list) else []


def _due(raw: str | None) -> str | None:
    return raw[:10] if raw and not raw.startswith(NO_DATE) else None


def order(tasks: list[dict]) -> list[dict]:
    """Dated tasks first (soonest), then by priority (highest), then the most recently changed."""
    return sorted(tasks, key=lambda t: (t["due"] is None, t["due"] or "", -t["priority"], -t["updated"]))


def open_tasks(url: str, project: str | None = None) -> dict:
    """{"tasks": [...], "total": n, "url": base}: every open task (or one project's), most urgent first."""
    cfg = configured(url)
    if not cfg:
        raise VikunjaError("Vikunja isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN).")
    base, token = cfg
    projects = {p.get("id"): p.get("title", "") for p in _get(base, token, "/projects", {"per_page": 200})}
    raw: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        got = _get(base, token, "/tasks", {"filter": "done = false", "per_page": PER_PAGE, "page": page})
        raw += got
        if len(got) < PER_PAGE:
            break
    out = []
    for t in raw:
        name = projects.get(t.get("project_id"), "")
        if project and name.lower() != project.lower():
            continue
        try:
            updated = dt.datetime.fromisoformat(str(t.get("updated", "")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            updated = 0.0
        out.append({"id": int(t.get("id", 0)), "title": str(t.get("title", ""))[:200], "project": name,
                    "due": _due(t.get("due_date")), "priority": int(t.get("priority") or 0), "updated": updated,
                    "url": f"{base}/tasks/{t.get('id')}"})
    return {"tasks": order(out), "total": len(out), "url": base}
