"""Stale sessions (ticket 847): no turn for 7 days, not running, no open card, not a delegation's or on a page; Orb
archives them on its own (Restore undoes it), the Away recap counts them, and a session's Finished time survives a
restart."""

import asyncio
import time

from orb import away, server
from orb.sessions import STALE_DAYS, SessionStore

DAY = 86400


def store(tmp_path, *ages, folder="/acme"):
    st = SessionStore(tmp_path / "s.json")
    now = time.time()
    keys = []
    for age in ages:
        k = st.new_session(folder)
        st.data[folder]["sessions"][k]["last_used"] = now - age * DAY
        keys.append(k)
    return st, keys, now


def test_seven_days_without_a_turn_archives_and_six_does_not(tmp_path):
    st, (old, young, edge), now = store(tmp_path, 8, 6, STALE_DAYS)
    assert st.archive_stale(lambda k: False, now=now) == 2
    got = {s["key"]: s for s in st.sessions("/acme")}
    assert got[old]["archived"] and got[edge]["archived"] and not got[young].get("archived")
    assert got[old]["auto_archived"] == now and st.active("/acme") is None  # edge was active
    assert st.archive_stale(lambda k: False, now=now) == 0  # already archived: nothing again


def test_a_recent_finish_counts_as_a_turn_and_kept_sessions_stay(tmp_path):
    st, (finished, held), now = store(tmp_path, 10, 10)
    st.set_finished("/acme", finished, now - 2 * DAY)
    assert st.archive_stale(lambda k: k == held, now=now) == 0


def test_restore_undoes_it_with_the_resume_id_and_leaves_the_recap(tmp_path):
    st, (k,), now = store(tmp_path, 9)
    st.set_resume("/acme", k, "claude-1")
    st.archive_stale(lambda k: False, now=now)
    assert st.auto_archived() == [now]
    assert st.set_archived("/acme", k, False)
    assert st.auto_archived() == [] and st.resume_id("/acme", k) == "claude-1"
    assert not st.sessions("/acme")[0].get("archived")


def test_an_owner_archive_is_not_counted(tmp_path):
    st, (k,), _ = store(tmp_path, 1)
    st.set_archived("/acme", k, True)
    assert st.auto_archived() == []


def test_finished_at_is_kept_on_disk_and_cleared_once_opened(tmp_path):
    st, (k,), now = store(tmp_path, 0)
    st.set_finished("/acme", k, now)
    again = SessionStore(tmp_path / "s.json")  # a restart
    assert again.sessions("/acme")[0]["finished_at"] == now
    again.set_finished("/acme", k, None)
    assert "finished_at" not in SessionStore(tmp_path / "s.json").sessions("/acme")[0]


def test_the_recap_line_counts_archives_since_the_owner_left():
    assert away.own_lines([], [], 100, [50]) == []
    assert away.own_lines([], [], 100, [150]) == [
        {"kind": "archived", "id": "archived", "title": "1 old session archived", "summary": "", "count": 1, "at": 150}]
    assert away.own_lines([], [], 100, [150, 160])[0]["title"] == "2 old sessions archived"


class Live:
    busy, pending = False, {}

    def __init__(self, **kw):
        self.__dict__.update(kw)

    def running_tasks(self):
        return getattr(self, "tasks", [])


def test_the_hub_keeps_running_waiting_delegated_and_viewed_sessions(tmp_path, monkeypatch):
    st, (busy, card, tasks, deleg, viewed, free), now = store(tmp_path, 9, 9, 9, 9, 9, 9)
    hub = server.hub
    monkeypatch.setattr(hub, "store", st)
    monkeypatch.setattr(hub, "sessions", {busy: Live(busy=True), card: Live(pending={"1": None}),
                                          tasks: Live(tasks=[{"coder": True}])})
    monkeypatch.setattr(hub.delegator, "items", {"1": {"session": deleg, "stage": "working"}})

    class Conn:
        key = viewed
    monkeypatch.setattr(hub, "conns", {Conn()})

    async def nothing():
        return None
    monkeypatch.setattr(hub, "push_folders", nothing)
    assert asyncio.run(hub.archive_stale(now=now)) == 1
    assert [s["key"] for s in st.sessions("/acme") if s.get("archived")] == [free]
    assert hub.archived_at == now


def test_a_restarted_session_with_a_finished_time_is_still_finished(tmp_path, monkeypatch):
    st, (k,), now = store(tmp_path, 0)
    st.set_finished("/acme", k, now)
    hub = server.hub
    monkeypatch.setattr(hub, "store", st)
    monkeypatch.setattr(hub, "sessions", {})
    assert hub.session_list("/acme")[0]["status"] == "done"  # not loaded yet
    assert hub.session("/acme", k).unseen is True  # loaded after a restart
