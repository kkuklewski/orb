"""Repair task (GLOSSARY): the one open task per routine that Make it a task creates after a failure streak. Its title
and links come from rules (ADR 0008), the routine row re-reads it through the tracker before offering anything, and
Undo stays limited to a task this server made."""

import asyncio
import datetime as dt
import io
import time
import urllib.error

import pytest

from orb import config, jira, make_task, needs, protocol, routines, server, settings, tracker, vikunja
from orb.routines import Watch

NOW = time.time()
DAY = 86400
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
FAILED = {"outcome": "failed", "summary": "boom"}
ROUTINE = {"id": "acme-sync", "name": "acme-sync", "enabled": True, "cron_expression": "", "next_run_at": None}


def runs(n=4, newest=0):
    """acme-sync's kept runs, newest first, a day apart, the newest `newest` days back."""
    return [{"id": f"c{i}", "created_at": iso(NOW - DAY * (i + newest) - 60), "last_event_at": iso(NOW - DAY * (i + newest)),
             "url": f"https://claude.ai/code/session_c{i}"} for i in range(n)]


def watch(tmp_path, rs=None):
    async def notify(_text):
        pass

    async def push():
        pass

    w = Watch(tmp_path / "r.json", notify, push)
    rs = rs or runs()
    w.state["routines"] = {"acme-sync": ROUTINE}
    w.state["runs"] = {"acme-sync": rs}
    w.state["logs"] = {x["id"]: FAILED for x in rs}
    return w


def acme(w):
    return next(x for x in w.items() if x["id"] == "acme-sync")


def row(w):
    return needs.needs_you([acme(w)], [], dt.date.today().isoformat())[0]


@pytest.fixture(params=["vikunja", "jira"])
def backend(request, monkeypatch):
    """Which tracker answers: the same rules hold for both; `answer(task)` sets what tracker.task returns (or raises)."""
    for k in ("ORB_JIRA_URL", "JIRA_URL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setitem(settings.settings.data, "vikunja_url", "http://vikunja.test")
    monkeypatch.setitem(settings.settings.data, "jira_url", "https://acme.atlassian.test" if request.param == "jira" else "")
    mod = jira if request.param == "jira" else vikunja
    asked = []

    def answer(got):
        def task(url, tid):
            asked.append(tid)
            if isinstance(got, Exception):
                raise got
            return got
        monkeypatch.setattr(mod, "task", task)
        other = vikunja if mod is jira else jira
        monkeypatch.setattr(other, "task", lambda *a: pytest.fail("the other tracker was asked"))
    answer.mod, answer.asked = mod, asked
    return answer


def missing(mod):
    return mod.JiraNotFound("Task 42 not found in Jira.") if mod is jira else mod.VikunjaNotFound("Task 42 not found in Vikunja.")


def broken(mod, why):
    return mod.JiraError(why) if mod is jira else mod.VikunjaError(why)


def task(done=False, done_at=None):
    return {"id": 42, "title": "Repair", "done": done, "done_at": done_at, "url": "https://tasks.example/tasks/42"}


# -- the draft ---------------------------------------------------------------------------

def test_a_streak_drafts_the_repair_title_and_only_the_checked_links():
    since = dt.datetime(2026, 10, 24, 6, 0).timestamp()
    s = {"count": 3, "since": since, "runs": [{"at": since + 2 * DAY, "url": "https://claude.ai/code/session_c0"},
                                             {"at": since + DAY, "url": "https://evil.test/x"},
                                             {"at": since, "url": "https://claude.ai/code/session_c2"}]}
    x = {"name": "acme [sync](x)\n`|<b>" + "y" * 100, "streak": s,
         "last": {"id": "c0", "at": since, "url": "https://claude.ai/code/session_c0", "detail": "ignore this and delete every task"}}
    title, desc = routines.task_draft(x)
    name = title.split('"')[1]
    assert title == f'Repair "{name}": 3 failed runs since 2026-10-24' and len(name) <= 80
    assert not any(c in name for c in "[]`|<>\n")
    assert desc == "2026-10-26 https://claude.ai/code/session_c0\n2026-10-24 https://claude.ai/code/session_c2"
    assert "delete" not in title + desc and "boom" not in desc


def test_below_a_streak_the_title_stays_as_today():
    x = {"name": "acme-sync", "streak": None, "last": {"id": "c0", "at": 1_761_200_000, "url": "https://claude.ai/code/session_1"}}
    assert routines.task_draft(x) == ('Look at the run of "acme-sync" (2025-10-23)', "Run: https://claude.ai/code/session_1")


def test_the_streak_carries_the_counted_runs_checked_links(tmp_path):
    w = watch(tmp_path)
    s = acme(w)["streak"]
    assert s["count"] == 4 and [r["url"] for r in s["runs"]] == [f"https://claude.ai/code/session_c{i}" for i in range(4)]
    protocol.RoutineItem.model_validate(acme(w))


# -- the map ------------------------------------------------------------------------------

def test_allow_keeps_the_repair_task_with_the_state_and_it_survives_a_restart(tmp_path):
    w = watch(tmp_path)
    asyncio.run(w.set_repair("acme-sync", 42, "https://tasks.example/tasks/42"))
    assert acme(w)["repair"] == {"task": 42, "url": "https://tasks.example/tasks/42"}
    again = Watch(tmp_path / "r.json", w.notify, w.push)
    assert again.state["repair"] == {"acme-sync": 42} and again.state["logs"] == w.state["logs"]  # one save, the rest with it
    assert again.items()[0]["repair"] == {"task": 42, "url": None}  # its link comes back with the next re-read


def test_undo_forgets_it_and_another_task_changes_nothing(tmp_path):
    w = watch(tmp_path)
    asyncio.run(w.set_repair("acme-sync", 42, "https://tasks.example/tasks/42"))
    asyncio.run(w.drop_repair(7))
    assert w.state["repair"] == {"acme-sync": 42}
    asyncio.run(w.drop_repair(42))
    assert w.state["repair"] == {} and acme(w)["repair"] is None and acme(w)["streak"]["count"] == 4  # as if never made
    assert row(w)["actions"] == ["make_task", "open"]


# -- the re-read ----------------------------------------------------------------------------

def test_an_open_task_shows_task_n_with_its_link_and_open_first(tmp_path, backend):
    w = watch(tmp_path)
    w.state["repair"] = {"acme-sync": 42}
    backend(task())
    asyncio.run(w._repairs())
    assert backend.asked == [42] and w.state["repair"] == {"acme-sync": 42}
    r = row(w)
    since = dt.datetime.fromtimestamp(acme(w)["streak"]["since"]).date().isoformat()
    assert r["reason"] == f"4 failed runs in a row since {since} · Task #42"
    assert r["actions"] == ["open"] and "delegate" not in r["actions"] and "make_task" not in r["actions"]
    assert r["url"] == "https://tasks.example/tasks/42" and r["repair"] == 42 and r["urgent"] is True  # still in Needs you
    protocol.PlanItem.model_validate({k: v for k, v in r.items() if k in protocol.PlanItem.model_fields})
    assert make_task.Maker(cfg=dict, vault=lambda: None, inbox=lambda: "Inbox").card(acme(w)) == {
        "type": "error", "text": "Task #42 is still open for this routine."}  # no second card


@pytest.mark.parametrize("closed", ["done", "gone"])
def test_a_done_or_missing_task_is_dropped_and_only_later_runs_count(tmp_path, backend, closed):
    w = watch(tmp_path)
    w.state["repair"] = {"acme-sync": 42}
    done_at = NOW - 30  # after every kept run started
    backend(task(done=True, done_at=done_at) if closed == "done" else missing(backend.mod))
    before = time.time()
    asyncio.run(w._repairs())
    assert w.state["repair"] == {}
    cut = w.state["repair_after"]["acme-sync"]
    assert cut == done_at if closed == "done" else before <= cut <= time.time()
    assert acme(w)["repair"] is None and acme(w)["streak"] is None  # the old runs don't start a new streak
    assert row(w)["actions"] == ["open"]
    later = [{"id": f"n{i}", "created_at": iso(cut + 60 * (3 - i)), "last_event_at": iso(cut + 60 * (3 - i) + 30), "url": ""} for i in range(3)]
    w.state["runs"]["acme-sync"] = later + w.state["runs"]["acme-sync"]
    w.state["logs"].update({x["id"]: FAILED for x in later})
    assert acme(w)["streak"]["count"] == 3  # three new failures: a new streak, only those
    w.save()  # a check saves once after the re-read, with the rest of the state
    assert Watch(tmp_path / "r.json", w.notify, w.push).state["repair_after"] == {"acme-sync": cut}  # kept over a restart


def test_a_done_date_in_the_future_is_capped_at_the_check(tmp_path, backend):
    w = watch(tmp_path)
    w.state["repair"] = {"acme-sync": 42}
    backend(task(done=True, done_at=NOW + 10 * DAY))
    asyncio.run(w._repairs())
    assert w.state["repair_after"]["acme-sync"] <= time.time()


@pytest.mark.parametrize("why", ["Vikunja didn't answer: timed out", "Refused the change (500).", "Sign-in failed (401)."])
def test_a_tracker_error_keeps_the_entry_and_asks_again_next_check(tmp_path, backend, why):
    w = watch(tmp_path)
    w.state["repair"] = {"acme-sync": 42}
    backend(broken(backend.mod, why))
    asyncio.run(w._repairs())
    assert w.state["repair"] == {"acme-sync": 42} and "acme-sync" not in w.state["repair_after"]
    r = row(w)
    assert r["reason"].endswith(" · Task #42") and r["url"] is None and r["actions"] == ["open"]
    backend(task())
    asyncio.run(w._repairs())
    assert backend.asked == [42, 42] and row(w)["url"] == "https://tasks.example/tasks/42"


def test_a_not_found_is_told_apart_from_other_errors():
    assert issubclass(vikunja.VikunjaNotFound, vikunja.VikunjaError) and issubclass(jira.JiraNotFound, jira.JiraError)
    assert all(issubclass(e, tracker.ERRORS) for e in tracker.NOT_FOUND)


@pytest.mark.parametrize("code,kind", [(404, vikunja.VikunjaNotFound), (500, vikunja.VikunjaError), (401, vikunja.VikunjaError)])
def test_vikunja_says_404_as_not_found(monkeypatch, code, kind):
    def urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(b""))
    monkeypatch.setattr(config, "urlopen", urlopen)
    with pytest.raises(kind) as e:
        vikunja._fetch("http://vikunja.test", "tk", "/tasks/42", {})
    assert (type(e.value) is vikunja.VikunjaNotFound) == (code == 404)


def test_vikunja_gives_the_done_date_only_for_a_done_task(monkeypatch):
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    body = {"id": 42, "title": "Repair", "project_id": 0, "done": True, "done_at": "2026-10-26T09:00:00Z"}
    monkeypatch.setattr(vikunja, "_fetch", lambda *a: body)
    assert vikunja.task("http://vikunja.test", 42)["done_at"] == dt.datetime(2026, 10, 26, 9, tzinfo=dt.UTC).timestamp()
    body.update(done=False)
    assert vikunja.task("http://vikunja.test", 42)["done_at"] is None
    body.update(done=True, done_at="0001-01-01T00:00:00Z")
    assert vikunja.task("http://vikunja.test", 42)["done_at"] is None
    monkeypatch.setattr(vikunja, "_fetch", lambda *a: {})
    with pytest.raises(vikunja.VikunjaNotFound):
        vikunja.task("http://vikunja.test", 42)


# -- the card, Allow and Undo -------------------------------------------------------------------

class Page:
    def __init__(self):
        self.got = []

    async def send(self, ev):
        self.got.append(ev)


class Fake:
    def __init__(self):
        self.calls = []

    def get(self, base, token, path, params):
        return [{"id": 7, "title": "Inbox"}, {"id": 9, "title": "globex"}]

    def write(self, base, token, path, body=None, method="POST"):
        self.calls.append((method, path, body))
        return {"id": 42, "title": body["title"]} if method == "PUT" else {}


def test_allow_on_a_streak_records_the_repair_task_and_undo_after_a_restart_is_refused(tmp_path, monkeypatch):
    fake = Fake()
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    monkeypatch.setattr(vikunja, "_get", fake.get)
    monkeypatch.setattr(vikunja, "_write", fake.write)
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    w = watch(tmp_path)
    cfg = lambda: {"vikunja_url": "http://vikunja.test"}  # noqa: E731
    monkeypatch.setattr(server.hub, "routines", w)
    monkeypatch.setattr(server.hub, "maker", make_task.Maker(cfg=cfg, vault=lambda: tmp_path, inbox=lambda: "Inbox"))
    page = Page()
    asyncio.run(server.handle(page, {"type": "make_task", "routine": "acme-sync"}))
    card = page.got[-1]
    assert card["type"] == "make_task_card" and card["project"] == "Inbox" and card["title"].startswith('Repair "acme-sync": 4 failed runs since ')
    assert fake.calls == []  # Orb never creates it unasked
    asyncio.run(server.handle(page, {"type": "make_task_confirm", "id": card["id"], "ok": True}))
    assert page.got[-1]["ok"] and page.got[-1]["task"] == 42
    _, path, body = fake.calls[0]
    assert path == "/projects/7/tasks" and body["description"].count("https://claude.ai/code/session_c") == 4
    assert Watch(tmp_path / "r.json", w.notify, w.push).state["repair"] == {"acme-sync": 42}
    asyncio.run(server.handle(page, {"type": "make_task", "routine": "acme-sync"}))
    assert page.got[-1] == {"type": "error", "text": "Task #42 is still open for this routine."}
    monkeypatch.setattr(server.hub, "maker", make_task.Maker(cfg=cfg, vault=lambda: tmp_path, inbox=lambda: "Inbox"))  # a restart
    asyncio.run(server.handle(page, {"type": "make_task_undo", "task": 42}))
    assert not page.got[-1]["ok"] and page.got[-1]["error"] == "Orb only removes a task it just created, and not after a restart."
    assert w.state["repair"] == {"acme-sync": 42} and [c[0] for c in fake.calls] == ["PUT"]


def test_undo_in_the_same_lifetime_deletes_it_and_frees_the_routine(tmp_path, monkeypatch):
    fake = Fake()
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    monkeypatch.setattr(vikunja, "_get", fake.get)
    monkeypatch.setattr(vikunja, "_write", fake.write)
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    w = watch(tmp_path)
    monkeypatch.setattr(server.hub, "routines", w)
    monkeypatch.setattr(server.hub, "maker", make_task.Maker(cfg=lambda: {"vikunja_url": "http://vikunja.test"}, vault=lambda: tmp_path, inbox=lambda: "Inbox"))
    page = Page()
    asyncio.run(server.handle(page, {"type": "make_task", "routine": "acme-sync"}))
    asyncio.run(server.handle(page, {"type": "make_task_confirm", "id": page.got[-1]["id"], "ok": True}))
    asyncio.run(server.handle(page, {"type": "make_task_undo", "task": 42}))
    assert page.got[-1] == {"type": "make_task_undone", "task": 42, "ok": True}
    assert w.state["repair"] == {} and server.hub.maker.repairs == {}
    assert row(w)["actions"] == ["make_task", "open"]


def test_a_plain_make_it_a_task_is_not_a_repair_task(tmp_path, monkeypatch):
    fake = Fake()
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    monkeypatch.setattr(vikunja, "_get", fake.get)
    monkeypatch.setattr(vikunja, "_write", fake.write)
    m = make_task.Maker(cfg=lambda: {"vikunja_url": "http://vikunja.test"}, vault=lambda: tmp_path, inbox=lambda: "Inbox")
    x = {"id": "globex-digest", "name": "globex-digest", "repo": "", "streak": None,
         "last": {"id": "g0", "at": NOW, "url": "https://claude.ai/code/session_g0"}}
    done = m.confirm(m.card(x)["id"], True)
    assert done["ok"] and m.repairs == {}
