"""Sessions waiting for an OK (ticket 848): the row's clock starts when the oldest Allow card opened, it turns red
needs.WAITING_H later (ADR 0012), the Away recap says how many wait now, and Orb never answers or denies a card."""

import time

from orb import away, needs, server

H = 3600


def test_the_waiting_rule_is_red_a_day_after_the_card_opened():
    assert needs.waiting(None) == {"waiting_since": None, "red_at": None}
    assert needs.waiting(1000.0) == {"waiting_since": 1000.0, "red_at": 1000.0 + 24 * H}
    assert needs.WAITING_H == 24


class Live:
    def __init__(self, *ages: float) -> None:
        now = time.monotonic()
        self.pending = {f"p{i}": (None, {"summary": "Bash(ls)", "_created": now - a}) for i, a in enumerate(ages)}


def test_the_clock_is_the_oldest_open_card_in_wall_time():
    assert server.card_since(None) is None
    assert server.card_since(Live()) is None
    got = server.card_since(Live(60, 3 * H))
    assert abs(got - (time.time() - 3 * H)) < 5


def test_the_session_row_carries_it(monkeypatch):
    hub = server.hub
    monkeypatch.setattr(hub.store, "sessions", lambda path: [{"key": "w1", "label": "fix login", "last_used": 1.0}])
    live = Live(2 * H)
    live.status, live.busy, live.history, live.live, live.info = "approval", False, [], True, {}
    live.running_tasks = lambda: []
    monkeypatch.setitem(hub.sessions, "w1", live)
    row, = hub.session_list("/r")
    assert row["status"] == "approval" and row["ask"] == "Bash(ls)"
    assert abs(row["waiting_since"] - (time.time() - 2 * H)) < 5 and row["red_at"] == row["waiting_since"] + 24 * H
    monkeypatch.setattr(hub.store, "sessions", lambda path: [{"key": "w2", "label": "idle one"}])
    row, = hub.session_list("/r")
    assert row["waiting_since"] is None and row["red_at"] is None


def test_the_away_line_counts_the_sessions_waiting_now():
    assert away.waiting_line(0) == []
    assert away.waiting_line(1) == [{"kind": "waiting", "id": "waiting", "title": "1 session waits for your OK", "summary": "", "count": 1}]
    assert away.waiting_line(3)[0]["title"] == "3 sessions wait for your OK"


def test_the_hub_adds_it_after_orbs_own_lines_and_leaves_delegations_to_their_row(monkeypatch):
    hub = server.hub
    rows = [{"key": "a", "status": "approval", "archived": False}, {"key": "b", "status": "approval", "archived": False},
            {"key": "c", "status": "idle", "archived": False}, {"key": "deleg", "status": "approval", "archived": False}]
    monkeypatch.setattr(hub, "folder_list", lambda: [{"label": "acme", "path": "/acme", "sessions": rows}])
    monkeypatch.setattr(hub.store, "sessions", lambda path: rows)  # none has finished_at
    monkeypatch.setattr(hub.store, "auto_archived", lambda: [])
    monkeypatch.setattr(hub.delegator, "items", {"1": {"session": "deleg", "stage": "running"}})
    monkeypatch.setitem(server.settings.settings.data, "routines", False)
    got = hub.away_lines(time.time() - 30 * H)
    assert [(x["kind"], x["count"]) for x in got] == [("waiting", 2)]
