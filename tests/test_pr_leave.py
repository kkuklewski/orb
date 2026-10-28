"""Leave it on a quiet pull request (ticket 850): open, non-draft, no update for 14+ days gets Leave it beside Start; it
hides the PR until its updatedAt changes, on every page and after a restart. Orb never writes to the PR."""

import asyncio

from orb import needs, server, settings

from test_brain_page import MESSAGES, Page
from test_needs import ranker

TODAY = "2026-10-28"


def pr(number, idle, updated="2026-10-01T08:00:00Z", draft=False):
    return {"repo": "acme/web", "number": number, "title": f"Change {number}", "url": "", "idle_days": idle,
            "updated": updated, "draft": draft}


def prs_in(q):
    return {c["key"]: c["actions"] for c in q if c["kind"] == "pr"}


def test_leave_it_shows_only_from_fourteen_quiet_days_and_never_on_a_draft():
    q = needs.queue([], [], [], [pr(1, 13), pr(2, 14), pr(3, 40, draft=True)], 0, TODAY)
    assert prs_in(q) == {"pr:acme/web#1": ["start", "later"], "pr:acme/web#2": ["start", "later", "leave"]}


def test_a_left_pr_stays_hidden_until_it_changes():
    left = {"pr:acme/web#2": "2026-10-01T08:00:00Z"}
    assert prs_in(needs.queue([], [], [], [pr(2, 20)], 0, TODAY, left=left)) == {}
    back = needs.queue([], [], [], [pr(2, 0, updated="2026-10-28T09:00:00Z")], 0, TODAY, left=left)
    assert list(prs_in(back)) == ["pr:acme/web#2"]


def hub_needs(tmp_path):
    sent, _, ask, push = ranker(['{"items": []}'])
    return needs.Needs(tmp_path / "n.json", ask, push), sent


def test_leave_hides_it_on_every_page_and_after_a_restart(tmp_path):
    n, sent = hub_needs(tmp_path)
    asyncio.run(n.update(TODAY, prs=[pr(2, 20), pr(5, 30, updated="2026-09-01T08:00:00Z")], now=1000.0))
    assert asyncio.run(n.leave("pr:acme/web#2")) is True
    shown = [sent[-1]["next"], *sent[-1]["up_next"]]
    assert [c["key"] for c in shown if c] == ["pr:acme/web#5"]
    again, _ = hub_needs(tmp_path)
    assert again.state["left"] == {"pr:acme/web#2": "2026-10-01T08:00:00Z"}


def test_leave_refuses_a_young_or_unknown_pr_and_writes_nothing(tmp_path):
    n, _ = hub_needs(tmp_path)
    asyncio.run(n.update(TODAY, prs=[pr(1, 13)], now=1000.0))
    assert asyncio.run(n.leave("pr:acme/web#1")) is False
    assert asyncio.run(n.leave("pr:globex/api#9")) is False
    assert "left" not in n.state


def test_entries_for_changed_or_closed_prs_go_with_the_next_leave(tmp_path):
    n, _ = hub_needs(tmp_path)
    n.state["left"] = {"pr:acme/web#1": "2026-09-01T08:00:00Z", "pr:acme/web#7": "2026-09-01T08:00:00Z"}
    asyncio.run(n.update(TODAY, prs=[pr(1, 15, updated="2026-10-10T08:00:00Z"), pr(2, 20)], now=1000.0))
    assert asyncio.run(n.leave("pr:acme/web#2")) is True
    assert n.state["left"] == {"pr:acme/web#2": "2026-10-01T08:00:00Z"}  # #1 changed, #7 is gone


def test_the_page_message_leaves_it(tmp_path, monkeypatch):
    n, _ = hub_needs(tmp_path)
    asyncio.run(n.update(TODAY, prs=[pr(2, 20)], now=1000.0))
    monkeypatch.setattr(server.hub, "needs", n)
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    msg = {"type": "plan_leave", "key": "pr:acme/web#2"}
    MESSAGES.validate_python(msg)
    asyncio.run(server.handle(Page(), msg))
    assert n.state["left"] == {"pr:acme/web#2": "2026-10-01T08:00:00Z"}
