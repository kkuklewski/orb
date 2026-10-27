"""Open issues from Jira Cloud: the Tasks source when a Jira address is set (ADR 0010). Same shape and the same writes as
`vikunja.py` (done, priority, due date, "Make it a task" and its Undo), so the rest of Orb doesn't care which one it is.

The address comes from settings ("jira_url", e.g. https://acme.atlassian.net) or ORB_JIRA_URL; the account email and API
token only from the environment (ORB_JIRA_EMAIL, ORB_JIRA_TOKEN), so they never land in settings.json. Which issues
count as "my open tasks" is a JQL query: ORB_JIRA_JQL, else the ones assigned to that account and not done.

Issue ids are Jira's numeric ids (the REST API takes them wherever it takes a key), so a task id is an int everywhere;
the key (ACME-12) leads the title, so the owner sees and says it.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import config, folders, vikunja

PER_PAGE = 100
MAX_PAGES = 20
TIMEOUT = 8
JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
FIELDS = "summary,project,duedate,created,updated,priority,status,labels"  # labels: read only (needs.py pin labels)
PROJECTS_TTL = 600  # project keys -> ids for the repo map; they rarely change
# Jira's default priority names on Orb's (Vikunja's) 0-5 scale: 0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now.
PRIORITY = {"lowest": 1, "low": 1, "medium": 2, "high": 3, "highest": 4}
PRIORITY_NAME = {1: "Low", 2: "Medium", 3: "High", 4: "Highest", 5: "Highest"}  # 5 reads back as 4: Jira has no sixth name

_projects_cache: dict[str, tuple[float, list[dict]]] = {}


class JiraError(Exception):
    pass


class JiraNotFound(JiraError):
    """Jira answered 404: the issue isn't there, or this account may not see it."""


def wanted(url: str) -> bool:
    """An address is set (settings or env): the owner wants Jira as the Tasks source."""
    return (url or config.env("JIRA_URL", "")).strip().startswith(("http://", "https://"))


def configured(url: str) -> tuple[str, str] | None:
    """(base url, Authorization header) when the address, email and token are all set."""
    base = (url or config.env("JIRA_URL", "")).strip().rstrip("/")
    email, token = config.secret("JIRA_EMAIL").strip(), config.secret("JIRA_TOKEN").strip()
    if not (base.startswith(("http://", "https://")) and email and token):
        return None
    return base, "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()


def _cfg(url: str) -> tuple[str, str]:
    cfg = configured(url)
    if not cfg:
        raise JiraError("Jira isn't set up (jira_url, ORB_JIRA_EMAIL and ORB_JIRA_TOKEN).")
    return cfg


def _said(e: urllib.error.HTTPError) -> str:
    """Jira's own words for a refusal ({"errorMessages": [...], "errors": {field: text}}), if it gave any."""
    try:
        body = json.loads(e.read() or b"{}")
    except (OSError, ValueError):
        return ""
    words = [*(body.get("errorMessages") or []), *(f"{k}: {v}" for k, v in (body.get("errors") or {}).items())]
    return "; ".join(str(w) for w in words)[:300]


def _call(base: str, auth: str, path: str, params: dict | None = None, body: dict | None = None, method: str = "GET") -> object:
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    req = urllib.request.Request(f"{base}/rest/api/3{path}{query}", data=None if body is None else json.dumps(body).encode(),
                                 method=method, headers={"Authorization": auth, "Accept": "application/json",
                                                         "Content-Type": "application/json"})
    try:
        with config.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        said = _said(e)
        if e.code == 401:
            raise JiraError("Jira refused the sign-in: check ORB_JIRA_EMAIL and ORB_JIRA_TOKEN (an API token from "
                            "id.atlassian.com).") from e
        if e.code == 403:
            raise JiraError(f"Jira refused: this account may not do that{' (' + said + ')' if said else ''}.") from e
        if e.code == 404:
            raise JiraNotFound(f"Not found in Jira{' (' + said + ')' if said else ''}.") from e
        raise JiraError(f"Jira refused the change ({e.code}{': ' + said if said else ''}).") from e
    except OSError as e:
        raise JiraError(f"Jira didn't answer: {e}") from e
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def _priority(raw: object) -> int:
    return PRIORITY.get(str((raw or {}).get("name", "")).casefold(), 0) if isinstance(raw, dict) else 0


def _updated(raw: object) -> float:
    try:
        return dt.datetime.fromisoformat(str(raw or "")).timestamp()
    except ValueError:
        return 0.0


def _title(issue: dict) -> str:
    return f"{issue.get('key', '')} {(issue.get('fields') or {}).get('summary', '')}".strip()[:200]


def _browse(base: str, key: str) -> str:
    return f"{base}/browse/{urllib.parse.quote(key)}"


def _row(base: str, issue: dict) -> dict:
    f = issue.get("fields") or {}
    project = f.get("project") or {}
    return {"id": int(issue.get("id", 0)), "title": _title(issue), "project": str(project.get("name", "")),
            "project_id": int(project.get("id") or 0), "due": f.get("duedate") or None,
            "created": str(f.get("created", ""))[:10], "priority": _priority(f.get("priority")),
            "updated": _updated(f.get("updated")), "url": _browse(base, str(issue.get("key", ""))),
            "labels": [str(x)[:80] for x in f.get("labels") or [] if isinstance(x, str) and x]}


def open_tasks(url: str, project: str | None = None) -> dict:
    """{"tasks": [...], "total": n, "url": base}: every open issue the JQL finds (or one project's), most urgent first."""
    base, auth = _cfg(url)
    raw: list[dict] = []
    token = None
    for _ in range(MAX_PAGES):
        params = {"jql": config.env("JIRA_JQL", JQL), "fields": FIELDS, "maxResults": PER_PAGE}
        if token:
            params["nextPageToken"] = token
        got = _call(base, auth, "/search/jql", params)
        page = got.get("issues") if isinstance(got, dict) else None
        raw += [i for i in page or [] if isinstance(i, dict) and str(i.get("id", "")).isdigit()]
        token = got.get("nextPageToken") if isinstance(got, dict) else None
        if not page or not token or got.get("isLast"):
            break
    if project:  # by name or key
        p = project.casefold()
        raw = [i for i in raw if p in {str(((i.get("fields") or {}).get("project") or {}).get(k, "")).casefold() for k in ("name", "key")}]
    out = [_row(base, i) for i in raw]
    return {"tasks": vikunja.order(out), "total": len(out), "url": base}


def source(url: str) -> dict:
    """Like `vikunja.source`: the open tasks, or none and "Jira not reachable: <reason>". Never raises."""
    try:
        return {**open_tasks(url), "error": None}
    except JiraError as e:
        return {"tasks": [], "total": 0, "url": None, "error": f"Jira not reachable: {str(e).removeprefix('Jira ')}"}


def plain(node: object) -> str:
    """A Jira description (Atlassian Document Format) as plain text."""
    def walk(n: object) -> str:
        if not isinstance(n, dict):
            return ""
        kind, attrs = n.get("type"), n.get("attrs") or {}
        if kind == "text":
            return str(n.get("text", ""))
        if kind == "hardBreak":
            return "\n"
        if kind in ("mention", "emoji"):
            return str(attrs.get("text") or attrs.get("shortName") or "")
        if kind in ("inlineCard", "blockCard"):
            return str(attrs.get("url", ""))
        inner = "".join(walk(c) for c in n.get("content") or [])
        if kind == "listItem":
            return "- " + inner.strip() + "\n"
        if kind in ("paragraph", "heading", "codeBlock", "blockquote", "bulletList", "orderedList", "rule", "panel", "table"):
            return inner + "\n\n"
        if kind in ("tableRow",):
            return inner + "\n"
        return inner
    return re.sub(r"\n{3,}", "\n\n", walk(node)).strip()


def adf(text: str) -> dict:
    """Plain text as a Jira description: a paragraph per blank-line block, line breaks kept."""
    paragraphs = []
    for block in re.split(r"\n\s*\n", text.strip()):
        content: list[dict] = []
        for i, line in enumerate(block.split("\n")):
            if i:
                content.append({"type": "hardBreak"})
            if line:
                content.append({"type": "text", "text": line})
        paragraphs.append({"type": "paragraph", "content": content})
    return {"type": "doc", "version": 1, "content": paragraphs}


def _issue(base: str, auth: str, task_id: int, fields: str) -> dict:
    i = _call(base, auth, f"/issue/{int(task_id)}", {"fields": fields})
    if not isinstance(i, dict) or not str(i.get("id", "")).isdigit():
        raise JiraNotFound(f"Task {task_id} not found in Jira.")
    return i


def _done(issue: dict) -> bool:
    return ((issue.get("fields") or {}).get("status") or {}).get("statusCategory", {}).get("key") == "done"


def task(url: str, task_id: int) -> dict:
    """One issue in full, in `vikunja.task`'s shape: {"id", "title", "description", "project", "project_id", "due",
    "priority", "done", "done_at", "url"}; done_at is when it was resolved (None while open or unknown)."""
    base, auth = _cfg(url)
    i = _issue(base, auth, task_id, FIELDS + ",description,resolutiondate")
    row = _row(base, i)
    return {**{k: row[k] for k in ("id", "title", "project", "project_id", "due", "priority", "url")},
            "description": plain((i.get("fields") or {}).get("description"))[:8000], "done": _done(i),
            "done_at": (_updated((i.get("fields") or {}).get("resolutiondate")) or None) if _done(i) else None}


def set_done(url: str, task_id: int, done: bool) -> None:
    """Done (or open again) through the issue's workflow: the first transition into the Done category (or To Do, else
    In Progress). Nothing happens when it is already there."""
    base, auth = _cfg(url)
    if _done(_issue(base, auth, task_id, "status")) == bool(done):
        return
    got = _call(base, auth, f"/issue/{int(task_id)}/transitions")
    moves = [t for t in (got.get("transitions") if isinstance(got, dict) else None) or [] if isinstance(t, dict)]
    wanted_cats = ("done",) if done else ("new", "indeterminate")
    for cat in wanted_cats:
        move = next((t for t in moves if ((t.get("to") or {}).get("statusCategory") or {}).get("key") == cat), None)
        if move:
            _call(base, auth, f"/issue/{int(task_id)}/transitions", body={"transition": {"id": str(move["id"])}}, method="POST")
            return
    raise JiraError(f"Task {task_id} has no workflow step to {'Done' if done else 'To Do'} that this account may take.")


def set_priority(url: str, task_id: int, priority: int) -> None:
    """Orb's 0-5 scale onto Jira's default names (Low, Medium, High, Highest); 0 clears it, as unset is in Vikunja (a
    project that requires a priority refuses that, and the owner sees Jira's reason)."""
    if not 0 <= priority <= 5:
        raise JiraError("Priority is 0 to 5.")
    base, auth = _cfg(url)
    _call(base, auth, f"/issue/{int(task_id)}", body={"fields": {"priority": {"name": PRIORITY_NAME[priority]} if priority else None}},
          method="PUT")


def set_due(url: str, task_id: int, day: str) -> None:
    base, auth = _cfg(url)
    _call(base, auth, f"/issue/{int(task_id)}", body={"fields": {"duedate": dt.date.fromisoformat(day).isoformat()}}, method="PUT")


def _projects(base: str, auth: str) -> list[dict]:
    """[{"id", "key", "name"}] of every project this account sees; kept a few minutes."""
    hit = _projects_cache.get(base)
    if hit and time.time() - hit[0] < PROJECTS_TTL:
        return hit[1]
    out: list[dict] = []
    start = 0
    for _ in range(MAX_PAGES):
        got = _call(base, auth, "/project/search", {"startAt": start, "maxResults": 50})
        values = [p for p in (got.get("values") if isinstance(got, dict) else None) or []
                  if isinstance(p, dict) and str(p.get("id", "")).isdigit()]
        out += [{"id": int(p["id"]), "key": str(p.get("key", "")), "name": str(p.get("name", ""))} for p in values]
        start += len(values)
        if not values or got.get("isLast", True):
            break
    _projects_cache[base] = (time.time(), out)
    return out


def projects(url: str) -> dict[int, str]:
    """Project id -> name."""
    base, auth = _cfg(url)
    return {p["id"]: p["name"] for p in _projects(base, auth)}


def _frontmatter(vault: Path | None) -> list[tuple[str, str]]:
    """(jira_project, local) from the vault's projects/*.md frontmatter, like `vikunja.repo_map`."""
    out = []
    if not vault:
        return out
    for f in sorted((vault / "projects").glob("*.md")):
        if not folders.inside(vault, f):
            continue
        try:
            head = f.read_text(encoding="utf-8").split("---", 2)
        except (OSError, UnicodeDecodeError):
            continue
        if len(head) < 3 or head[0].strip():
            continue
        meta = dict(m.groups() for m in re.finditer(r"^(\w+):\s*(.+?)\s*$", head[1], re.M))
        if meta.get("jira_project") and meta.get("local", "").startswith("/"):
            out.append((meta["jira_project"].strip().strip("\"'"), meta["local"]))
    return out


def repo_map(url: str, vault: Path | None) -> dict[int, str]:
    """Jira project id -> local repo path, from `jira_project: <KEY or id>` + `local: <path>` in the vault's projects/*.md.
    Keys are looked up in Jira; when it can't be read, only the numeric ids count."""
    pairs = _frontmatter(vault)
    if not pairs:
        return {}
    try:
        by_key = {p["key"].casefold(): p["id"] for p in _projects(*_cfg(url))}
    except JiraError:
        by_key = {}
    out: dict[int, str] = {}
    for ref, local in pairs:
        pid = int(ref) if ref.isdigit() else by_key.get(ref.casefold())
        if pid:
            out.setdefault(pid, local)
    return out


def repo_path(url: str, vault: Path | None, project_id: int) -> str | None:
    return repo_map(url, vault).get(project_id) if project_id else None


def project_for(url: str, vault: Path | None, repo: str | None, inbox: str) -> tuple[int, str]:
    """(id, name) of the project a new issue goes to: the one mapped to `repo`, else the `inbox` project (by name or key)."""
    base, auth = _cfg(url)
    known = _projects(base, auth)
    names = {p["id"]: p["name"] for p in known}
    if repo:
        for pid, path in repo_map(url, vault).items():
            if pid in names and folders.remote_label(folders._git_config_remote(Path(path))) == repo:
                return pid, names[pid]
    want = inbox.strip().casefold()
    p = next((p for p in known if want in (p["name"].casefold(), p["key"].casefold())), None)
    if p is None:
        raise JiraError(f'No Jira project called "{inbox}" to put the task in (Settings: tasks_inbox).')
    return p["id"], p["name"]


def _issue_type(base: str, auth: str, project_id: int) -> str:
    got = _call(base, auth, "/issuetype/project", {"projectId": int(project_id)})
    types = [t for t in got if isinstance(t, dict) and t.get("id")] if isinstance(got, list) else []
    pick = next((t for t in types if str(t.get("name", "")).casefold() == "task"), None) \
        or next((t for t in types if not t.get("subtask")), None)
    if pick is None:
        raise JiraError("That Jira project has no issue type a new task can use.")
    return str(pick["id"])


def create(url: str, project_id: int, title: str, description: str = "") -> dict:
    """A new issue (type Task, else the project's first non-subtask type): {"id", "title", "url"}."""
    base, auth = _cfg(url)
    fields: dict = {"project": {"id": str(int(project_id))}, "summary": title[:255],
                    "issuetype": {"id": _issue_type(base, auth, project_id)}}
    if description.strip():
        fields["description"] = adf(description)
    got = _call(base, auth, "/issue", body={"fields": fields}, method="POST")
    if not isinstance(got, dict) or not str(got.get("id", "")).isdigit():
        raise JiraError("Jira didn't say which issue it created.")
    key = str(got.get("key", ""))
    return {"id": int(got["id"]), "title": f"{key} {title}".strip()[:200], "url": _browse(base, key)}


def delete(url: str, task_id: int) -> None:
    base, auth = _cfg(url)
    _call(base, auth, f"/issue/{int(task_id)}", method="DELETE")

