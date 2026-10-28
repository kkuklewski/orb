"""Finished sessions not opened for 3 days (ticket 849): they leave their own Up next item for one
"N finished sessions not opened", never red, Later hides it; after a week the Stale-session rule archives them."""

import time

from orb import needs, server

D = 86400
NOW = 1_800_000_000.0


def res(key, age_days, field="finished_at"):
    return {"key": key, "label": f"acme {key}", "repo": "acme", "last_used": NOW - 9 * D, field: NOW - age_days * D}


def kinds(q):
    return [(c["key"], c["title"]) for c in q]


def test_under_three_days_each_stays_its_own_item():
    q = needs.queue([], [], [res("a", 2.9)], [], 0, "2026-10-28", now=NOW)
    assert kinds(q) == [("result:a", "acme a")]


def test_from_three_days_they_count_in_one_item():
    q = needs.queue([], [], [res("a", 1), res("b", 3), res("c", 5)], [], 0, "2026-10-28", now=NOW)
    assert kinds(q) == [("result:a", "acme a"), ("results:old", "2 finished sessions not opened")]
    old = q[1]
    assert old["kind"] == "results_old" and old["group"] == "queue" and old["actions"] == ["start", "later"]
    one = needs.queue([], [], [res("b", 4)], [], 0, "2026-10-28", now=NOW)
    assert kinds(one) == [("results:old", "1 finished session not opened")]


def test_only_the_finished_time_counts_and_later_hides_the_item():
    r = {"key": "x", "label": "globex", "repo": "globex", "last_used": NOW - 9 * D}  # no finished time: its own item
    assert kinds(needs.queue([], [], [r], [], 0, "2026-10-28", now=NOW)) == [("result:x", "globex")]
    assert needs.queue([], [], [res("a", 4)], [], 0, "2026-10-28", {"results:old"}, now=NOW) == []


def test_the_item_is_never_needs_you_and_never_red():
    q = needs.queue([], [], [res("a", 10)], [], 0, "2026-10-28", now=NOW)
    assert all(c.get("group") == "queue" and not c.get("pin") for c in q)


def test_the_hubs_results_carry_the_finished_time(monkeypatch):
    hub = server.hub
    t = time.time() - 4 * D
    monkeypatch.setattr(hub, "folder_list", lambda: [{"label": "acme", "sessions": [
        {"key": "s1", "label": "fix login", "last_used": t, "finished_at": t, "status": "done", "archived": False},
        {"key": "s2", "label": "idle", "last_used": t, "finished_at": None, "status": "idle", "archived": False}]}])
    assert hub.results() == [{"key": "s1", "label": "fix login", "repo": "acme", "last_used": t, "finished_at": t}]
