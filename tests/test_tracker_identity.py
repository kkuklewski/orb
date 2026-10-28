"""Who Orb is in the tracker and who holds a task (ticket 871, map 861): `tracker.me` reads Vikunja's /user or Jira's
/myself with the token Orb already has and keeps it in memory; open-task rows and a full task carry their assignees."""

import pytest

from orb import jira, tracker, vikunja

VBASE = "http://vikunja.test"
JBASE = "https://acme.atlassian.net"
VCFG = {"vikunja_url": VBASE}
JCFG = {"jira_url": JBASE}


@pytest.fixture(autouse=True)
def tokens(monkeypatch):
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "vt")
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "jt")
    vikunja._me_cache.clear()
    jira._me_cache.clear()


class Calls:
    def __init__(self, answer):
        self.answer, self.n = answer, 0

    def __call__(self, *a, **k):
        self.n += 1
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_vikunja_me_reads_user_once(monkeypatch):
    got = Calls({"id": 7, "username": "acme-dev", "name": "Acme Dev"})
    monkeypatch.setattr(vikunja, "_fetch", lambda base, token, path, params: path == "/user" and got())
    assert tracker.me(VCFG) == {"id": "7", "name": "Acme Dev", "username": "acme-dev"}
    assert tracker.me(VCFG)["id"] == "7" and got.n == 1


def test_vikunja_me_falls_back_to_the_username_and_a_new_token_asks_again(monkeypatch):
    got = Calls({"id": 7, "username": "acme-dev", "name": ""})
    monkeypatch.setattr(vikunja, "_fetch", lambda *a: got())
    assert tracker.me(VCFG)["name"] == "acme-dev"
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "other")
    tracker.me(VCFG)
    assert got.n == 2


def test_a_failure_is_not_kept(monkeypatch):
    calls = Calls(vikunja.VikunjaError("Vikunja didn't answer: down"))
    monkeypatch.setattr(vikunja, "_fetch", lambda *a: calls())
    with pytest.raises(tracker.ERRORS):
        tracker.me(VCFG)
    calls.answer = {}  # answered, but not a user
    with pytest.raises(tracker.ERRORS, match="who this token is"):
        tracker.me(VCFG)
    calls.answer = {"id": 7, "username": "acme-dev"}
    assert tracker.me(VCFG)["id"] == "7" and calls.n == 3


def test_vikunja_me_needs_the_setup(monkeypatch):
    monkeypatch.delenv("ORB_VIKUNJA_TOKEN")
    with pytest.raises(tracker.ERRORS, match="isn't set up"):
        tracker.me(VCFG)


def test_jira_me_reads_myself_once(monkeypatch):
    got = Calls({"accountId": "5b10ac8d82e05b22cc7d4ef5", "displayName": "Globex Dev", "emailAddress": "x@globex.test"})
    monkeypatch.setattr(jira, "_call", lambda base, auth, path, *a, **k: path == "/myself" and got())
    me = tracker.me(JCFG)
    assert me == {"id": "5b10ac8d82e05b22cc7d4ef5", "name": "Globex Dev", "username": "Globex Dev"}
    tracker.me(JCFG)
    assert got.n == 1
    monkeypatch.setattr(jira, "_call", lambda *a, **k: {"accountId": "x"})
    jira._me_cache.clear()
    with pytest.raises(tracker.ERRORS, match="who this account is"):
        tracker.me(JCFG)


def test_vikunja_rows_and_task_carry_assignees(monkeypatch):
    rows = [{"id": 1, "title": "Fix login", "project_id": 3, "assignees": [{"id": 7, "username": "acme-dev", "name": "Acme Dev"},
                                                                           {"id": 9, "username": "globex"}]},
            {"id": 2, "title": "Write docs", "project_id": 3, "assignees": None}]

    def get(base, token, path, params):
        if path == "/projects":
            return [{"id": 3, "title": "Acme"}]
        return rows if params.get("page") == 1 else []

    monkeypatch.setattr(vikunja, "_get", get)
    got = {t["id"]: t["assignees"] for t in tracker.open_tasks(VCFG)["tasks"]}
    assert got == {1: [{"id": "7", "name": "Acme Dev"}, {"id": "9", "name": "globex"}], 2: []}
    monkeypatch.setattr(vikunja, "_fetch", lambda base, token, path, params: rows[0] if path == "/tasks/1" else {"title": "Acme"})
    assert tracker.task(VCFG, 1)["assignees"] == [{"id": "7", "name": "Acme Dev"}, {"id": "9", "name": "globex"}]


def test_jira_rows_and_task_carry_the_assignee(monkeypatch):
    def issue(id_, assignee):
        return {"id": id_, "key": f"ACME-{id_}", "fields": {"summary": "x", "project": {"id": "1", "name": "Acme"},
                                                           "status": {"statusCategory": {"key": "new"}}, "assignee": assignee}}
    held = issue("11", {"accountId": "a-1", "displayName": "Acme Dev"})
    asked = []

    def call(base, auth, path, params=None, body=None, method="GET"):
        asked.append((path, (params or {}).get("fields", "")))
        if path == "/search/jql":
            return {"issues": [held, issue("12", None)], "isLast": True}
        return held

    monkeypatch.setattr(jira, "_call", call)
    got = {t["id"]: t["assignees"] for t in tracker.open_tasks(JCFG)["tasks"]}
    assert got == {11: [{"id": "a-1", "name": "Acme Dev"}], 12: []}
    assert tracker.task(JCFG, 11)["assignees"] == [{"id": "a-1", "name": "Acme Dev"}]
    assert all("assignee" in f.split(",") for path, f in asked if path != "/myself")  # a row has an assignee: held_by asks who Orb is
