"""Jira Cloud as the task tracker (ADR 0010): the same task shape and writes as Vikunja, chosen when a Jira address is set."""

import base64
import io
import urllib.error

import pytest

from orb import items, jira, make_task, needs, settings, tracker, vikunja

BASE = "https://acme.atlassian.net"
CFG = {"jira_url": BASE, "vikunja_url": "http://vikunja.test"}


def issue(id_, key, summary, project=("10000", "ACME", "Acme"), due=None, prio="Medium", cat="new", desc=None):
    return {"id": id_, "key": key, "fields": {
        "summary": summary, "project": {"id": project[0], "key": project[1], "name": project[2]}, "duedate": due,
        "created": "2026-10-01T09:00:00.000+0200", "updated": "2026-10-20T10:00:00.000+0200",
        "priority": {"name": prio}, "status": {"name": "x", "statusCategory": {"key": cat}}, "description": desc}}


class FakeJira:
    """Answers `_call` like Jira's REST API v3; records every write."""

    def __init__(self):
        self.issues = {"10001": issue("10001", "ACME-1", "Fix login", due="2026-10-30", prio="High"),
                       "10002": issue("10002", "ACME-2", "Write docs", prio="Lowest"),
                       "10003": issue("10003", "GLOB-7", "Ship it", project=("10100", "GLOB", "Globex"), prio="Highest")}
        self.writes = []
        self.pages = 0

    def __call__(self, base, auth, path, params=None, body=None, method="GET"):
        assert base == BASE and auth.startswith("Basic ")
        if method != "GET":
            self.writes.append((method, path, body))
        if path == "/search/jql":
            self.pages += 1
            ids = sorted(self.issues)
            if params.get("nextPageToken") == "p2":
                return {"issues": [self.issues[i] for i in ids[2:]], "isLast": True}
            return {"issues": [self.issues[i] for i in ids[:2]], "nextPageToken": "p2", "isLast": False}
        if path == "/project/search":
            return {"values": [{"id": "10000", "key": "ACME", "name": "Acme"}, {"id": "10100", "key": "GLOB", "name": "Globex"},
                               {"id": "10200", "key": "INBOX", "name": "Inbox"}], "isLast": True}
        if path == "/issuetype/project":
            return [{"id": "3", "name": "Sub-task", "subtask": True}, {"id": "1", "name": "Bug"}, {"id": "2", "name": "Task"}]
        if path.endswith("/transitions"):
            return {"transitions": [{"id": "11", "to": {"statusCategory": {"key": "new"}}},
                                    {"id": "21", "to": {"statusCategory": {"key": "indeterminate"}}},
                                    {"id": "31", "to": {"statusCategory": {"key": "done"}}}]}
        if path == "/issue" and method == "POST":
            return {"id": "10009", "key": "INBOX-4"}
        if path.startswith("/issue/") and method == "GET":
            return self.issues[path.rsplit("/", 1)[1]]
        return {}


@pytest.fixture
def fake(monkeypatch):
    f = FakeJira()
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "tk")
    monkeypatch.setattr(jira, "_call", f)
    jira._projects_cache.clear()
    return f


def test_jira_needs_address_email_and_token_from_the_environment(monkeypatch):
    monkeypatch.delenv("ORB_JIRA_EMAIL", raising=False)
    monkeypatch.setenv("ORB_JIRA_TOKEN", "tk")
    assert jira.wanted(BASE) and jira.configured(BASE) is None
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    base, auth = jira.configured(BASE + "/")
    assert base == BASE and base64.b64decode(auth.removeprefix("Basic ")) == b"dev@acme.test:tk"
    assert jira.configured("ftp://acme") is None


def test_open_issues_read_every_page_in_vikunjas_shape_most_urgent_first(fake):
    got = jira.open_tasks(BASE)
    assert fake.pages == 2 and got["total"] == 3 and got["url"] == BASE
    first = got["tasks"][0]
    assert first == {"id": 10001, "title": "ACME-1 Fix login", "project": "Acme", "project_id": 10000, "due": "2026-10-30",
                     "created": "2026-10-01", "priority": 3, "updated": first["updated"], "url": f"{BASE}/browse/ACME-1", "labels": [], "assignees": []}
    assert first["updated"] > 0
    assert [t["id"] for t in got["tasks"]] == [10001, 10003, 10002]  # dated first, then Highest (4) before Lowest (1)
    assert [t["id"] for t in jira.open_tasks(BASE, "glob")["tasks"]] == [10003]  # a project by key...
    assert [t["id"] for t in jira.open_tasks(BASE, "Acme")["tasks"]] == [10001, 10002]  # ...or by name


def test_one_issue_in_full_with_its_description_as_plain_text(fake):
    fake.issues["10002"]["fields"]["description"] = {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Steps:"}, {"type": "hardBreak"}, {"type": "text", "text": "open it"}]},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "a"}]}]},
                                           {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "b"}]}]}]},
        {"type": "paragraph", "content": [{"type": "mention", "attrs": {"text": "@globex"}}, {"type": "inlineCard", "attrs": {"url": "https://x.test"}}]}]}
    t = jira.task(BASE, 10002)
    assert t["description"] == "Steps:\nopen it\n\n- a\n- b\n\n@globexhttps://x.test"
    assert t["done"] is False and t["title"] == "ACME-2 Write docs" and t["priority"] == 1


def test_done_and_reopen_go_through_the_workflow(fake):
    jira.set_done(BASE, 10001, True)
    assert fake.writes == [("POST", "/issue/10001/transitions", {"transition": {"id": "31"}})]
    fake.writes.clear()
    jira.set_done(BASE, 10001, False)  # already open: nothing to do
    assert fake.writes == []
    fake.issues["10001"]["fields"]["status"]["statusCategory"]["key"] = "done"
    jira.set_done(BASE, 10001, False)
    assert fake.writes == [("POST", "/issue/10001/transitions", {"transition": {"id": "11"}})]


def test_done_without_a_workflow_step_says_so(fake, monkeypatch):
    real = fake.__call__
    monkeypatch.setattr(jira, "_call", lambda b, a, path, *r, **k: {"transitions": []} if path.endswith("/transitions") else real(b, a, path, *r, **k))
    with pytest.raises(jira.JiraError, match="no workflow step to Done"):
        jira.set_done(BASE, 10002, True)


def test_priority_and_due_date(fake):
    jira.set_priority(BASE, 10001, 4)
    jira.set_priority(BASE, 10001, 0)
    jira.set_due(BASE, 10001, "2026-11-03")
    assert fake.writes == [("PUT", "/issue/10001", {"fields": {"priority": {"name": "Highest"}}}),
                           ("PUT", "/issue/10001", {"fields": {"priority": None}}),
                           ("PUT", "/issue/10001", {"fields": {"duedate": "2026-11-03"}})]
    with pytest.raises(jira.JiraError):
        jira.set_priority(BASE, 10001, 6)


def test_repo_map_from_jira_project_keys_or_ids(fake, tmp_path):
    (tmp_path / "projects").mkdir()
    (tmp_path / "projects" / "acme.md").write_text("---\nlocal: /code/acme\njira_project: ACME\n---\n")
    (tmp_path / "projects" / "globex.md").write_text("---\nlocal: /code/globex\njira_project: 10100\n---\n")
    (tmp_path / "projects" / "gone.md").write_text("---\nlocal: /code/gone\njira_project: NOPE\n---\n")
    (tmp_path / "projects" / "vk.md").write_text("---\nlocal: /code/vk\nvikunja_project: 5\n---\n")
    assert jira.repo_map(BASE, tmp_path) == {10000: "/code/acme", 10100: "/code/globex"}
    assert jira.repo_path(BASE, tmp_path, 10000) == "/code/acme" and jira.repo_path(BASE, None, 10000) is None


def test_make_it_a_task_creates_a_jira_task_in_the_inbox_and_undo_deletes_it(fake, tmp_path):
    m = make_task.Maker(cfg=lambda: CFG, vault=lambda: tmp_path, inbox=lambda: "inbox")
    card = m.card({"id": "r1", "name": "Nightly", "last": {"url": "https://claude.ai/code/routines/r1/runs/5"}})
    assert card["type"] == "make_task_card" and card["project"] == "Inbox"
    done = m.confirm(card["id"], True)
    assert done["ok"] and done["task"] == 10009 and done["url"] == f"{BASE}/browse/INBOX-4" and done["title"].startswith("INBOX-4 ")
    method, path, body = fake.writes[0]
    assert (method, path) == ("POST", "/issue")
    assert body["fields"]["project"] == {"id": "10200"} and body["fields"]["issuetype"] == {"id": "2"}  # Task, not Bug
    assert body["fields"]["description"]["type"] == "doc"
    assert m.undo(10009)["ok"] and fake.writes[-1] == ("DELETE", "/issue/10009", None)


def test_adf_keeps_paragraphs_and_line_breaks():
    doc = jira.adf("one\ntwo\n\nthree")
    assert doc["content"] == [
        {"type": "paragraph", "content": [{"type": "text", "text": "one"}, {"type": "hardBreak"}, {"type": "text", "text": "two"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "three"}]}]
    assert jira.plain(doc) == "one\ntwo\n\nthree"


def test_a_refusal_says_what_to_fix(monkeypatch):
    def refuse(code, body):
        def urlopen(req, timeout):
            raise urllib.error.HTTPError(req.full_url, code, "no", {}, io.BytesIO(body))
        return urlopen
    monkeypatch.setattr(jira.config, "urlopen", refuse(401, b""))
    with pytest.raises(jira.JiraError, match="ORB_JIRA_EMAIL and ORB_JIRA_TOKEN"):
        jira._call(BASE, "Basic x", "/issue/1")
    monkeypatch.setattr(jira.config, "urlopen", refuse(400, b'{"errorMessages": [], "errors": {"duedate": "bad date"}}'))
    with pytest.raises(jira.JiraError, match=r"\(400: duedate: bad date\)"):
        jira._call(BASE, "Basic x", "/issue/1", method="PUT", body={})


def test_the_tracker_is_jira_when_its_address_is_set_else_vikunja(fake, monkeypatch):
    monkeypatch.delenv("ORB_JIRA_URL", raising=False)
    assert tracker.name(CFG) == "Jira" and tracker.name({"vikunja_url": "http://v"}) == "Vikunja"
    assert tracker.task(CFG, 10001)["title"] == "ACME-1 Fix login"
    monkeypatch.setattr(vikunja, "task", lambda url, i: {"from": url})
    assert tracker.task({"vikunja_url": "http://v"}, 1) == {"from": "http://v"}
    assert "(Jira)" in tracker.brief(CFG, {"title": "t", "url": "u"})
    got = items.get("vikunja", "10001", CFG, None, [])
    assert got["kicker"] == "JIRA" and got["url_label"] == "Open in Jira →"


def test_jira_down_is_said_by_name(monkeypatch):
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "tk")
    monkeypatch.setattr(jira, "_call", lambda *a, **k: (_ for _ in ()).throw(jira.JiraError("Jira didn't answer: timed out")))
    got = tracker.source(CFG)
    assert got["tasks"] == [] and got["error"] == "Jira not reachable: didn't answer: timed out"
    probs = needs.setup_problems({}, got["error"], "browser", "browser", {}, False, tracker.name(CFG))
    assert probs[0]["title"] == "Jira isn't reachable"


def test_jira_url_setting_takes_web_addresses_only(tmp_path):
    s = settings.Settings(tmp_path / "s.json")
    assert s.update({"jira_url": "https://acme.atlassian.net"})["jira_url"] == "https://acme.atlassian.net"
    assert s.update({"jira_url": "file:///etc"})["jira_url"] == ""


def test_tracker_calls_do_not_follow_redirects():
    # A redirect would carry the Authorization header to another address.
    import http.server
    import threading

    seen = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/elsewhere")
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    try:
        with pytest.raises(jira.JiraError, match="302"):
            jira._call(f"http://127.0.0.1:{srv.server_port}", "Basic x", "/myself")
    finally:
        srv.server_close()
    assert seen == ["/rest/api/3/myself"]


def test_open_issues_carry_their_label_names_and_labels_are_only_read(fake):
    fake.issues["10001"]["fields"]["labels"] = ["Money", "backend"]
    got = {t["id"]: t["labels"] for t in jira.open_tasks(BASE)["tasks"]}
    assert got == {10001: ["Money", "backend"], 10002: [], 10003: []}  # none set: an empty list, no error
    assert "labels" in jira.FIELDS.split(",") and fake.writes == []  # asked for, never written
