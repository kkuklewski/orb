"""Open tasks from a Vikunja task tracker: the Tasks source, for the Tasks list and Home. Writes: `set_done`
(Archive), `set_priority`, the due date, and "Make it a task" (`create`, and `delete` for its Undo; ADR 0008).

The address comes from settings ("vikunja_url") or ORB_VIKUNJA_URL; the API token only from the
environment (ORB_VIKUNJA_TOKEN), so it never lands in settings.json. Without both, Orb uses the
"- [ ]" tasks in the notes instead.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from pathlib import Path

from . import config, folders
from .brief import quoted

PER_PAGE = 100
MAX_PAGES = 20  # Vikunja caps a page at 50 whatever per_page says, so we read until a page comes back empty
TIMEOUT = 6
NO_DATE = "0001-01-01"  # Vikunja's "no due date"
HOME_SHOWN = 12  # tasks Home gets (it counts all of them)


class VikunjaError(Exception):
    pass


def wanted(url: str) -> bool:
    """An address is set (settings or env): the owner wants the Tasks source, so a missing token is an error to show."""
    return (url or config.env("VIKUNJA_URL", "")).strip().startswith(("http://", "https://"))


def configured(url: str) -> tuple[str, str] | None:
    """(base url, token) when both are set."""
    base = (url or config.env("VIKUNJA_URL", "")).strip().rstrip("/")
    token = config.env("VIKUNJA_TOKEN", "").strip()
    return (base, token) if base.startswith(("http://", "https://")) and token else None


def _fetch(base: str, token: str, path: str, params: dict) -> object:
    req = urllib.request.Request(f"{base}/api/v1{path}?{urllib.parse.urlencode(params)}",
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.load(r)
    except (OSError, ValueError) as e:
        raise VikunjaError(f"Vikunja didn't answer: {e}") from e
    return data


def _write(base: str, token: str, path: str, body: dict | None = None, method: str = "POST") -> object:
    req = urllib.request.Request(f"{base}/api/v1{path}", data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise VikunjaError("Vikunja refused: the token (ORB_VIKUNJA_TOKEN) needs write access to tasks.") from e
        raise VikunjaError(f"Vikunja refused the change ({e.code}).") from e
    except OSError as e:
        raise VikunjaError(f"Vikunja didn't answer: {e}") from e
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def _post(base: str, token: str, path: str, body: dict) -> None:
    _write(base, token, path, body)


def _cfg(url: str) -> tuple[str, str]:
    cfg = configured(url)
    if not cfg:
        raise VikunjaError("Vikunja isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN).")
    return cfg


def _get(base: str, token: str, path: str, params: dict) -> list[dict]:
    data = _fetch(base, token, path, params)
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
        if not got:
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
                    "project_id": int(t.get("project_id") or 0),
                    "due": _due(t.get("due_date")), "created": str(t.get("created", ""))[:10], "priority": int(t.get("priority") or 0), "updated": updated,
                    "url": f"{base}/tasks/{t.get('id')}"})
    return {"tasks": order(out), "total": len(out), "url": base}


def source(url: str) -> dict:
    """The Tasks source: {"tasks": [...] (every open task, most urgent first), "total", "url", "error": None}, or no
    tasks and "error": "Vikunja not reachable: <reason>" (not set up, down, refused). Never raises, so Tasks and Home
    show the reason where the tasks would be, instead of a list stuck on "…" and a line in the chat."""
    try:
        return {**open_tasks(url), "error": None}
    except VikunjaError as e:
        return {"tasks": [], "total": 0, "url": None, "error": f"Vikunja not reachable: {str(e).removeprefix('Vikunja ')}"}


def home_event(got: dict | None) -> dict:
    """{"type": "home_tasks", ...} from `source` (None = no Vikunja address): Home counts them and shows the first few."""
    if got is None:
        return {"type": "home_tasks", "tasks": None, "total": 0, "url": None, "error": None}
    return {"type": "home_tasks", **got, "tasks": got["tasks"][:HOME_SHOWN]}


def plain(text: str | None) -> str:
    """A Vikunja description (HTML) as plain text."""
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", text or "")
    t = html.unescape(re.sub(r"<[^>]+>", "", t.replace("<li>", "- ")))
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def task(url: str, task_id: int) -> dict:
    """One task in full: {"id", "title", "description" (plain text), "project", "project_id", "due", "priority", "done", "url"}."""
    cfg = configured(url)
    if not cfg:
        raise VikunjaError("Vikunja isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN).")
    base, token = cfg
    t = _fetch(base, token, f"/tasks/{int(task_id)}", {})
    if not isinstance(t, dict) or not t.get("id"):
        raise VikunjaError(f"Task {task_id} not found in Vikunja.")
    pid = int(t.get("project_id") or 0)
    project = _fetch(base, token, f"/projects/{pid}", {}) if pid else {}
    return {"id": int(t["id"]), "title": str(t.get("title", ""))[:200], "description": plain(t.get("description"))[:8000],
            "project": str(project.get("title", "")) if isinstance(project, dict) else "", "project_id": pid,
            "due": _due(t.get("due_date")), "priority": int(t.get("priority") or 0), "done": bool(t.get("done")),
            "url": f"{base}/tasks/{t['id']}"}


def _update(url: str, task_id: int, change: dict) -> None:
    """Change fields of a task. The whole task goes back with the change, because Vikunja's update resets the
    fields it isn't given."""
    cfg = configured(url)
    if not cfg:
        raise VikunjaError("Vikunja isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN).")
    base, token = cfg
    t = _fetch(base, token, f"/tasks/{int(task_id)}", {})
    if not isinstance(t, dict) or not t.get("id"):
        raise VikunjaError(f"Task {task_id} not found in Vikunja.")
    _post(base, token, f"/tasks/{int(task_id)}", {**t, **change})


def set_done(url: str, task_id: int, done: bool) -> None:
    """Archive (or bring back) a task: Vikunja has no per-task archive, so this marks it done (or open again)."""
    _update(url, task_id, {"done": bool(done)})


def set_priority(url: str, task_id: int, priority: int) -> None:
    """Vikunja's own scale: 0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 DO NOW."""
    if not 0 <= priority <= 5:
        raise VikunjaError("Priority is 0 to 5.")
    _update(url, task_id, {"priority": int(priority)})


def set_due(url: str, task_id: int, day: str) -> None:
    """Move a task's due date to `day` (YYYY-MM-DD): Vikunja has no snooze. Noon UTC, so the date reads the same in any zone."""
    _update(url, task_id, {"due_date": f"{dt.date.fromisoformat(day).isoformat()}T12:00:00Z"})


def repo_map(vault: Path | None) -> dict[int, str]:
    """Vikunja project id -> local repo path, from the vault's projects/*.md frontmatter
    (`vikunja_project: <id>`, `local: <absolute path>`). Projects without a repo here are left out."""
    out: dict[int, str] = {}
    if not vault:
        return out
    for f in sorted((vault / "projects").glob("*.md")):
        try:
            head = f.read_text(encoding="utf-8").split("---", 2)
        except (OSError, UnicodeDecodeError):
            continue
        if len(head) < 3 or head[0].strip():
            continue
        meta = dict(m.groups() for m in re.finditer(r"^(\w+):\s*(.+?)\s*$", head[1], re.M))
        if meta.get("vikunja_project", "").isdigit() and meta.get("local", "").startswith("/"):
            out.setdefault(int(meta["vikunja_project"]), meta["local"])
    return out


def projects(url: str) -> dict[int, str]:
    """Project id -> title."""
    base, token = _cfg(url)
    return {int(p["id"]): str(p.get("title", "")) for p in _get(base, token, "/projects", {"per_page": 200})
            if isinstance(p, dict) and p.get("id")}


def project_for(url: str, vault: Path | None, repo: str | None, inbox: str) -> tuple[int, str]:
    """(id, title) of the project a new task goes to: the one mapped to `repo` ("owner/name", matched by the
    mapped folder's git remote), else the `inbox` project (settings "tasks_inbox")."""
    known = projects(url)
    if repo:
        for pid, path in repo_map(vault).items():
            if pid in known and folders.remote_label(folders._git_config_remote(Path(path))) == repo:
                return pid, known[pid]
    pid = next((p for p, title in known.items() if title.casefold() == inbox.strip().casefold()), None)
    if pid is None:
        raise VikunjaError(f'No Vikunja project called "{inbox}" to put the task in (Settings: tasks_inbox).')
    return pid, known[pid]


def create(url: str, project_id: int, title: str, description: str = "") -> dict:
    """A new open task in a project: {"id", "title", "url"}."""
    base, token = _cfg(url)
    t = _write(base, token, f"/projects/{int(project_id)}/tasks", {"title": title, "description": description}, method="PUT")
    if not isinstance(t, dict) or not t.get("id"):
        raise VikunjaError("Vikunja didn't say which task it created.")
    return {"id": int(t["id"]), "title": str(t.get("title", title))[:200], "url": f"{base}/tasks/{t['id']}"}


def delete(url: str, task_id: int) -> None:
    base, token = _cfg(url)
    _write(base, token, f"/tasks/{int(task_id)}", method="DELETE")


def repo_path(vault: Path | None, project_id: int) -> str | None:
    """The local repo mapped to a Vikunja project, or None."""
    return repo_map(vault).get(project_id) if project_id else None


def brief(t: dict) -> str:
    """The prompt for working on a task; title, project and description come from the tracker, so they are quoted."""
    return quoted("a task from my task tracker (Vikunja)",
                  [("Task", t["title"]), ("Project", t.get("project") or "-"), ("Due", t.get("due")), ("Link", t["url"])],
                  t.get("description"),
                  "What I want: read the task, look at the repo, then say how you'd do it and what you need from me. "
                  "Don't change anything until I agree.")
