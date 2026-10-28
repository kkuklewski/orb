"""Orb's own caches pruned on load (ticket 851): needs.json marks older than 7 days, and priority suggestions whose
task is gone or done (a whole open list says so) or that were rated more than 30 days ago. Written back only on a
change; only the count is logged."""

import asyncio
import datetime as dt
import json
import logging

from orb import needs, triage

from test_needs import ranker

D = 86400
NOW = 1_800_000_000.0


def day(n):
    return (dt.date.today() - dt.timedelta(days=n)).isoformat()


def needs_file(tmp_path, **marks):
    p = tmp_path / "n.json"
    p.write_text(json.dumps({"fp": "", "at": None, "ranking": [], "error": None, "since": {}, **marks}))
    return p


def test_old_needs_marks_go_on_load_and_the_rest_stay(tmp_path, caplog):
    p = needs_file(tmp_path, started={"vikunja:1": day(8), "vikunja:2": day(7)}, later={"pr:acme/web#3": day(30)},
                   done={"note:inbox/acme.md:4": day(0)})
    _, _, ask, push = ranker(["{}"])
    with caplog.at_level(logging.INFO, logger="orb.needs"):
        n = needs.Needs(p, ask, push)
    assert n.state["started"] == {"vikunja:2": day(7)} and n.state["later"] == {} and n.state["done"] == {"note:inbox/acme.md:4": day(0)}
    assert json.loads(p.read_text())["started"] == {"vikunja:2": day(7)}  # written back
    assert "2 old marks pruned" in caplog.text and "vikunja" not in caplog.text  # the count only


def test_needs_marks_within_a_week_leave_the_file_untouched(tmp_path):
    p = needs_file(tmp_path, later={"vikunja:1": day(1)})
    before = p.stat().st_mtime_ns, p.read_text()
    _, _, ask, push = ranker(["{}"])
    needs.Needs(p, ask, push)
    assert (p.stat().st_mtime_ns, p.read_text()) == before


def cache(tmp_path, data):
    p = tmp_path / "s.json"
    p.write_text(json.dumps(data))
    return p


def test_suggestions_older_than_thirty_days_go_and_old_ones_without_a_time_are_stamped(tmp_path, caplog):
    p = cache(tmp_path, {"1": {"p": 2, "why": "", "fp": "a", "at": NOW - 31 * D},
                         "2": {"p": 3, "why": "", "fp": "b", "at": NOW - 29 * D}, "3": {"p": 1, "why": "", "fp": "c"}})
    with caplog.at_level(logging.INFO, logger="orb.triage"):
        got = triage.load(p, now=NOW)
    assert set(got) == {"2", "3"} and got["3"]["at"] == NOW and got["2"]["at"] == NOW - 29 * D
    assert json.loads(p.read_text()) == got and "1 pruned" in caplog.text


def test_a_whole_open_list_drops_gone_or_done_tasks_and_a_partial_one_drops_nothing(tmp_path):
    p = cache(tmp_path, {k: {"p": 2, "why": "", "fp": k, "at": NOW} for k in ("1", "2", "3")})
    whole = {"tasks": [{"id": 1}, {"id": 3}], "total": 2}
    assert triage.open_ids({**whole, "error": "Vikunja not reachable"}) is None
    assert triage.open_ids({**whole, "total": 9}) is None and triage.open_ids(None) is None
    assert set(triage.load(p, open_=None, now=NOW)) == {"1", "2", "3"}
    assert set(triage.load(p, open_=triage.open_ids(whole), now=NOW)) == {"1", "3"}
    assert set(json.loads(p.read_text())) == {"1", "3"}


def test_a_current_cache_is_not_written_again(tmp_path):
    p = cache(tmp_path, {"1": {"p": 2, "why": "", "fp": "a", "at": NOW}})
    before = p.stat().st_mtime_ns
    triage.load(p, open_={"1"}, now=NOW)
    assert p.stat().st_mtime_ns == before


def test_a_new_rating_carries_its_time(tmp_path):
    p = tmp_path / "s.json"

    async def ask(_):
        return '{"5": {"p": 3, "why": "due soon"}}'
    asyncio.run(triage.suggest([{"id": 5, "title": "Ship acme invoices"}], "2026-10-28", ask, p))
    assert isinstance(json.loads(p.read_text())["5"]["at"], float)
