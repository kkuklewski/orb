"""Failure streak (GLOSSARY): consecutive failed or judged-broken runs of one routine, a rule in routines.py."""

import datetime as dt
import json
import time

from orb import needs, protocol
from orb.routines import STREAK, Watch, item, streak, streak_window
from orb.settings import settings as live

NOW = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731


def runs(n=5):
    """acme-sync's kept runs, newest first, a day apart."""
    return [{"id": f"c{i}", "created_at": iso(NOW - 86400 * i - 60), "last_event_at": iso(NOW - 86400 * i), "url": ""} for i in range(n)]


FAILED, OK = {"outcome": "failed", "summary": "boom"}, {"outcome": "ok", "summary": "s"}
BROKEN, CLEAN = {"kind": "broken", "read": True, "why": "no data"}, {"kind": "none", "read": False, "why": ""}


def logs(*outcomes):
    return {f"c{i}": lg for i, lg in enumerate(outcomes) if lg is not None}


def test_streak_is_three_in_a_row_from_the_newest_run():
    assert STREAK == 3
    rs = runs()
    got = streak(rs, logs(FAILED, FAILED, FAILED, OK, OK), {"c3": CLEAN, "c4": CLEAN})
    assert {k: got[k] for k in ("count", "since")} == {"count": 3, "since": dt.datetime.fromisoformat(rs[2]["created_at"].replace("Z", "+00:00")).timestamp()}
    assert streak(rs, logs(FAILED, OK, FAILED), {"c1": BROKEN})["count"] == 3  # failed + broken + failed
    assert streak(rs, logs(FAILED, FAILED, FAILED, FAILED, FAILED))["count"] == 5  # all 5 kept runs
    assert streak(rs, logs(FAILED, FAILED, OK), {"c2": CLEAN}) is None  # 2 failed, then a clean ok
    assert streak(rs, logs(OK, FAILED, FAILED, FAILED), {"c0": CLEAN}) is None  # the newest run is fine: no streak


def test_every_breaker_breaks_it():
    rs = runs()
    for third, verdicts in [({"outcome": "ok"}, {"c2": {"kind": "action", "read": True, "why": "x"}}),  # action
                            ({"outcome": "waiting"}, {}), ({"outcome": "running"}, {}),  # waiting, stuck (a running run)
                            (None, {}),  # unknown: no log
                            ({"outcome": "ok"}, {})]:  # unknown: ok with no verdict
        assert streak(rs, logs(FAILED, FAILED, third, FAILED), verdicts) is None, third
    assert streak(rs, logs(FAILED, OK, FAILED), {"c1": BROKEN}, resolved="c1") is None  # a resolved run
    assert streak(rs, logs(FAILED, OK, FAILED), {"c1": BROKEN}, judge=False) is None  # judge off: nothing is broken


def test_the_item_carries_the_streak_and_a_missed_run_breaks_it():
    r = {"id": "acme-sync", "name": "acme-sync", "enabled": True, "cron_expression": "", "next_run_at": None}
    lg = logs(FAILED, FAILED, FAILED)
    assert item(r, runs(), lg, {}, NOW)["streak"]["count"] == 3
    missed = {**r, "next_run_at": iso(NOW - 2 * 3600)}  # a newer run that never happened
    assert item(missed, runs(), lg, {}, NOW)["streak"] is None
    assert item({**r, "enabled": False}, runs(), lg, {}, NOW)["streak"] is None
    protocol.RoutineItem.model_validate(item(r, runs(), lg, {}, NOW))


def test_needs_you_says_the_streak_and_offers_make_it_a_task_first():
    since = dt.datetime(2026, 10, 24, 6, 0).timestamp()
    base = {"id": "acme-sync", "name": "acme-sync", "enabled": True, "needs": "failed", "urgent": True,
            "last": {"id": "c0", "summary": "boom"}, "why": ""}
    row = needs.needs_you([{**base, "streak": {"count": 3, "since": since}}], [], "2026-10-27")[0]
    assert row["reason"] == "3 failed runs in a row since 2026-10-24"
    assert row["actions"] == ["make_task", "open"]
    plain = needs.needs_you([{**base, "id": "globex-digest", "name": "globex-digest", "streak": None}], [], "2026-10-27")[0]
    assert plain["actions"] == ["open"] and plain["reason"] == "boom"
    assert row["stable"] == plain["stable"] == "c0|failed" and row["urgent"] is True  # fingerprint unchanged
    protocol.PlanItem.model_validate({k: v for k, v in row.items() if k in protocol.PlanItem.model_fields})


def test_the_window_stops_at_a_known_breaker():
    rs = runs()
    assert streak_window(rs, logs(OK), {"c0": CLEAN}) == []  # the newest run doesn't count: nothing more is looked at
    assert [x["id"] for x in streak_window(rs, logs(FAILED))] == ["c1", "c2"]  # at most the last STREAK runs
    assert streak_window(rs, logs(FAILED, OK), {"c1": CLEAN}) == []  # c1 is a clean ok: c2 can't matter
    assert [x["id"] for x in streak_window(rs, logs(FAILED, OK))] == ["c1", "c2"]  # c1 waits for its verdict


def watch(tmp_path):
    async def notify(_text):
        pass

    async def push():
        pass

    w = Watch(tmp_path / "r.json", notify, push)
    rs = runs()
    w.state["routines"] = {"acme-sync": {"id": "acme-sync", "name": "acme-sync", "enabled": True, "cron_expression": "", "next_run_at": None},
                           "globex-digest": {"id": "globex-digest", "name": "globex-digest", "enabled": True, "cron_expression": "", "next_run_at": None}}
    w.state["runs"] = {"acme-sync": rs, "globex-digest": [{**x, "id": "g" + x["id"]} for x in rs]}
    return w


async def test_a_check_fetches_only_missing_logs_at_most_three_runs_and_judges_each_once(tmp_path, monkeypatch):
    monkeypatch.setitem(live.data, "routines_judge", True)
    w = watch(tmp_path)
    w.state["logs"] = {"c0": FAILED, "c2": FAILED, "gc0": OK}  # c2 is kept already; globex-digest's newest is fine
    w.state["verdicts"] = {"gc0": CLEAN}
    fetched, asked = [], []
    texts = {"c1": "[t] result: success is_error=false turns=2 — no rows came back"}

    async def fake_calls(calls):
        fetched.append([c["session_id"] for c in calls])
        assert all(c["action"] == "get_run_log" for c in calls)  # read-only, the same hooks
        return [(c, {"summary": texts[c["session_id"]]}) for c in calls]

    async def fake_judge(prompt):
        asked.append(prompt)
        return json.dumps({"c1": {"kind": "broken", "why": "no rows"}})

    monkeypatch.setattr(w, "_calls", fake_calls)
    monkeypatch.setattr(w, "_ask_judge", fake_judge)
    shown = list(w.state["routines"].values())
    await w._streak(shown)
    assert fetched == [["c1"]]  # only the missing one, never globex-digest's, never more than the last 3 runs
    assert len(asked) == 1 and 'id="c1"' in asked[0]  # one judge call for that run
    acme = next(x for x in w.items() if x["id"] == "acme-sync")
    assert acme["streak"]["count"] == 3
    await w._streak(shown)
    assert fetched == [["c1"]] and len(asked) == 1  # kept logs and verdicts aren't asked again
