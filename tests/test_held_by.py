"""A teammate's task on Home (#866 Q7, ticket 873): rows carry held_by (the other assignee's name), the suggestion is
only ever later, the queue offers no Delegate, and when Orb can't tell who it is nothing reads as held."""

import asyncio

import pytest

from orb import needs, protocol, suggest, tracker

TODAY = "2026-10-25"
ME = {"id": "7", "name": "Acme Dev", "username": "acme"}
MATE = {"id": "9", "name": "Globex Dev"}
VCFG = {"vikunja_url": "http://vikunja.test"}


def test_a_held_task_is_only_ever_later():
    for due, repo in (("2026-10-20", "web"), (TODAY, None), (None, "web"), (None, None)):
        assert suggest.task(due, repo, TODAY, "Globex Dev") == "later"
    assert suggest.task(None, "web", TODAY, None) == "delegate"


def test_held_by_is_the_first_other_assignee():
    assert tracker.held_by({"assignees": []}, ME) is None
    assert tracker.held_by({"assignees": [{"id": "7", "name": "Acme Dev"}]}, ME) is None  # mine is mine
    assert tracker.held_by({"assignees": [{"id": "7", "name": "Acme Dev"}, MATE]}, ME) == "Globex Dev"
    assert tracker.held_by({"assignees": [{"id": "9", "name": ""}]}, ME) == "a teammate"


@pytest.fixture
def rows(monkeypatch):
    got = {"tasks": [{"id": 1, "title": "Theirs", "assignees": [MATE]}, {"id": 2, "title": "Free", "assignees": []}],
           "total": 2, "url": None}
    monkeypatch.setattr(tracker.vikunja, "open_tasks", lambda url, project=None: got)
    monkeypatch.setattr(tracker.vikunja, "source", lambda url: {**got, "error": None})
    return got


def test_open_tasks_and_source_mark_a_teammates_task(monkeypatch, rows):
    asked = []
    monkeypatch.setattr(tracker, "me", lambda cfg: asked.append(1) or ME)
    assert [t["held_by"] for t in tracker.open_tasks(VCFG)["tasks"]] == ["Globex Dev", None]
    assert [t["held_by"] for t in tracker.source(VCFG)["tasks"]] == ["Globex Dev", None]
    assert len(asked) == 2


def test_nobody_assigned_asks_nobody_and_an_unknown_me_holds_nothing(monkeypatch, rows):
    def fail(cfg):
        raise tracker.vikunja.VikunjaError("Vikunja refused the token")

    monkeypatch.setattr(tracker, "me", fail)
    assert [t["held_by"] for t in tracker.open_tasks(VCFG)["tasks"]] == [None, None]
    rows["tasks"][0]["assignees"] = []
    monkeypatch.setattr(tracker, "me", lambda cfg: pytest.fail("no assignee: no need to ask"))
    assert [t["held_by"] for t in tracker.open_tasks(VCFG)["tasks"]] == [None, None]


def test_the_plan_tags_it_and_offers_no_delegate(tmp_path):
    sent = []

    async def ask(_):
        raise RuntimeError("no model here")

    async def push(ev):
        protocol.PlanEvent.model_validate(ev)
        sent.append(ev)

    tasks = [{"id": 1, "title": "Overdue, theirs", "project": "acme", "due": "2026-10-20", "repo": "web", "held_by": "Globex Dev"},
             {"id": 2, "title": "Mapped, theirs", "project": "acme", "due": None, "repo": "web", "held_by": "Globex Dev"},
             {"id": 3, "title": "Mapped, free", "project": "acme", "due": None, "repo": "web", "held_by": None}]
    asyncio.run(needs.Needs(tmp_path / "n.json", ask, push).update(TODAY, tasks=tasks, now=1.0))
    ev = sent[-1]
    by = {r["key"]: r for r in [*ev["needs_you"], ev["next"], *ev["up_next"]] if r}
    assert {k: (r["suggest"], r["held_by"]) for k, r in by.items()} == {
        "vikunja:1": ("later", "Globex Dev"), "vikunja:2": ("later", "Globex Dev"), "vikunja:3": ("delegate", None)}
    assert "delegate" not in by["vikunja:2"]["actions"] and "delegate" in by["vikunja:3"]["actions"]
    item, = [c for c in needs.queue(tasks[1:2], [], [], [], 0, TODAY)]
    assert item["facts"].endswith("; held by teammate Globex Dev")
