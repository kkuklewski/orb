import time

from orb.routines import Watch, allowed_call, call_key, hidden, item, parse_log

LOG_OK = """[2026-10-21T23:09:30Z] init: model=claude-sonnet-5-5 cwd=/home/user/x
[2026-10-21T23:09:42Z] assistant: Nothing to do.
[2026-10-21T23:09:42Z] result: success is_error=false turns=4 duration=13s — Both issues are excluded.   RESULT: nothing-to-do"""


def test_parse_log():
    assert parse_log(LOG_OK) == {"outcome": "ok", "summary": "Both issues are excluded. RESULT: nothing-to-do"}
    assert parse_log("[t] result: error_max_turns is_error=true turns=30 — ran out")["outcome"] == "failed"
    assert parse_log("[t] result: success is_error=true")["outcome"] == "failed"
    assert parse_log("[t] tool_use Bash: {}\n[t] permission prompt: Bash")["outcome"] == "waiting"
    assert parse_log(LOG_OK + "\n[t] user: more\n[t] permission prompt: Edit")["outcome"] == "waiting"
    assert parse_log("[t] env[info]: Allocating sandbox") == {"outcome": "running", "summary": ""}


def test_hidden(monkeypatch):
    from orb.settings import settings
    assert not hidden("Weekly sheet sync")  # nothing hidden on a new install
    monkeypatch.setitem(settings.data, "routines_hidden", ["sheet sync"])
    assert hidden("Weekly Sheet Sync (Google Sheets)")
    assert not hidden("night-backlog")


def routine(**kw):
    return {"id": "trig_1", "name": "night-backlog", "enabled": True, "cron_expression": "0 23 * * *",
            "next_run_at": "2099-01-01T00:00:00Z", **kw}


def run(sid="cse_1", ago=60):
    t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - ago))
    return {"id": sid, "created_at": t, "last_event_at": t, "url": "https://claude.ai/code/session_1"}


def test_item_needs():
    now = time.time()
    ok = item(routine(), [run()], {"cse_1": {"outcome": "ok", "summary": "fine"}}, {}, now)
    assert ok["needs"] is None and ok["new"] and ok["last"]["summary"] == "fine"
    assert item(routine(), [run()], {"cse_1": {"outcome": "ok"}}, {"trig_1": "cse_1"}, now)["new"] is False
    assert item(routine(), [run()], {"cse_1": {"outcome": "failed"}}, {}, now)["needs"] == "failed"
    assert item(routine(), [run()], {"cse_1": {"outcome": "waiting"}}, {}, now)["needs"] == "waiting"
    assert item(routine(), [run(ago=60)], {"cse_1": {"outcome": "running"}}, {}, now)["needs"] is None
    assert item(routine(), [run(ago=3600)], {"cse_1": {"outcome": "running"}}, {}, now)["needs"] == "stuck"
    assert item(routine(next_run_at="2020-01-01T00:00:00Z"), [], {}, {}, now)["needs"] == "missed"
    off = item(routine(enabled=False, next_run_at="2020-01-01T00:00:00Z"), [run()], {"cse_1": {"outcome": "failed"}}, {}, now)
    assert off["needs"] is None  # a paused routine never nags


def test_the_state_word_per_routine():
    now = time.time()
    ok = {"cse_1": {"outcome": "ok"}}
    state = lambda r=None, runs=None, logs=None, verdicts=None, seen=None: item(  # noqa: E731
        r or routine(), [run()] if runs is None else runs, ok if logs is None else logs, seen or {}, now, verdicts)["state"]
    assert state(logs={"cse_1": {"outcome": "failed"}}) == "failed"
    assert state(logs={"cse_1": {"outcome": "waiting"}}) == "stuck"  # waiting on a prompt reads as stuck
    assert state(runs=[run(ago=3600)], logs={"cse_1": {"outcome": "running"}}) == "stuck"
    assert state(routine(next_run_at="2020-01-01T00:00:00Z"), runs=[]) == "missed"
    assert state(verdicts={"cse_1": {"read": True, "kind": "broken", "why": "403"}}) == "needs you"
    assert state(verdicts={"cse_1": {"read": True, "kind": "action", "why": "sign"}}) == "needs you"
    assert state(verdicts={"cse_1": {"read": True, "why": "alert"}}) == "worth reading"
    assert state(verdicts={"cse_1": {"read": True, "why": "alert"}}, seen={"trig_1": "cse_1"}) == "nothing to report"  # read
    assert state(verdicts={"cse_1": {"read": False, "why": "quiet"}}) == "nothing to report"
    assert state(runs=[]) == "nothing to report"  # no runs yet
    assert state(routine(enabled=False), logs={"cse_1": {"outcome": "failed"}}) == "off"


def test_a_missed_routine_carries_the_time_it_missed():
    x = item(routine(next_run_at="2020-01-01T06:00:00Z"), [], {}, {}, time.time())
    assert x["next_run_at"] is None and x["missed_at"] == 1577858400
    assert item(routine(), [], {}, {}, time.time())["missed_at"] is None


def test_routines_come_grouped_by_state_and_by_name_inside(tmp_path):
    async def nothing(*_a):
        pass

    w = Watch(tmp_path / "r.json", nothing, nothing)
    names = {"t1": ("zeta", True, "ok"), "t2": ("Alpha", True, "ok"), "t3": ("beta", True, "failed"), "t4": ("aaa", False, "ok")}
    w.state["routines"] = {i: routine(id=i, name=n, enabled=e) for i, (n, e, _) in names.items()}
    w.state["runs"] = {i: [run(f"c{i}")] for i in names}
    w.state["logs"] = {f"c{i}": {"outcome": o} for i, (_, _, o) in names.items()}
    w.state["seen"] = {i: f"c{i}" for i in names}
    assert [(x["name"], x["state"]) for x in w.items()] == [
        ("beta", "failed"), ("Alpha", "nothing to report"), ("zeta", "nothing to report"), ("aaa", "off")]


def test_item_drops_foreign_links():
    r = run() | {"url": "https://evil.example/x"}
    assert item(routine(), [r], {}, {}, time.time())["last"]["url"] == ""
    r = run() | {"url": "javascript:alert(1)"}
    assert item(routine(), [r], {}, {}, time.time())["last"]["url"] == ""


def test_guard_allows_only_the_asked_reads():
    asked = {call_key({"action": "list_runs", "trigger_id": "trig_1"})}
    assert allowed_call("RemoteTrigger", {"action": "list_runs", "trigger_id": "trig_1"}, asked)
    assert allowed_call("RemoteTrigger", {"action": "list_runs", "trigger_id": "trig_1", "cursor": "x"}, asked)
    assert not allowed_call("RemoteTrigger", {"action": "list_runs", "trigger_id": "trig_2"}, asked)
    assert not allowed_call("RemoteTrigger", {"action": "run", "trigger_id": "trig_1"}, asked | {call_key({"action": "run", "trigger_id": "trig_1"})})
    assert not allowed_call("RemoteTrigger", {"action": "update", "trigger_id": "trig_1", "body": {}}, asked)
    assert not allowed_call("Bash", {"action": "list_runs", "trigger_id": "trig_1"}, asked)
    assert not allowed_call("mcp__claude_ai_Gmail__send_message", {}, asked)


def test_a_resolved_problem_stops_counting_until_the_next_run():
    now, broken = time.time(), {"read": True, "kind": "broken", "why": "paused"}
    x = item(routine(), [run()], {"cse_1": {"outcome": "ok"}}, {}, now, {"cse_1": broken}, resolved="cse_1")
    assert x["needs"] is None and x["resolved"] and x["state"] != "needs you"
    newer = item(routine(), [run("cse_2"), run()], {"cse_2": {"outcome": "ok"}}, {}, now, {"cse_2": broken}, resolved="cse_1")
    assert newer["needs"] == "broken" and not newer["resolved"]  # the next run is judged afresh
    failed = item(routine(), [run()], {"cse_1": {"outcome": "failed"}}, {}, now, resolved="cse_1")
    assert failed["needs"] == "failed" and not failed["resolved"]  # only a successful run clears a failure


def test_resolve_marks_only_a_judged_problem_and_can_be_undone(tmp_path):
    import asyncio

    pushes = []

    async def nothing(*_a):
        pass

    async def push():
        pushes.append(1)

    w = Watch(tmp_path / "r.json", nothing, push)
    w.state["routines"] = {"t1": routine(id="t1"), "t2": routine(id="t2", name="other")}
    w.state["runs"] = {"t1": [run("c1")], "t2": [run("c2")]}
    w.state["logs"] = {"c1": {"outcome": "ok"}, "c2": {"outcome": "failed"}}
    w.state["verdicts"] = {"c1": {"read": True, "kind": "action", "why": "sign"}}
    asyncio.run(w.resolve("t2"))  # a failure isn't resolvable
    assert w.state["resolved"] == {} and not pushes
    asyncio.run(w.resolve("t1"))
    assert w.state["resolved"] == {"t1": "c1"} and pushes
    assert [x["needs"] for x in w.items()] == ["failed", None]
    assert Watch(tmp_path / "r.json", nothing, nothing).state["resolved"] == {"t1": "c1"}  # kept across a restart
    asyncio.run(w.resolve("t1", undo=True))
    assert {x["id"]: x["needs"] for x in w.items()} == {"t1": "action", "t2": "failed"}


def test_away_lines_count_the_ok_runs_since_the_owner_left_and_keep_the_latest_summary():
    from orb.routines import away_lines
    now = time.time()
    runs = {"t1": [run("a3", ago=60), run("a2", ago=3600), run("a1", ago=90000)],  # two after they left, one before
            "t2": [run("b1", ago=60)], "t3": [run("c1", ago=60)], "t4": [run("d1", ago=90000)]}
    logs = {"a3": {"outcome": "ok", "summary": "3 created, 1 merged"}, "a2": {"outcome": "ok", "summary": "older"},
            "b1": {"outcome": "failed", "summary": "boom"}, "c1": {"outcome": "ok", "summary": "fine"},
            "d1": {"outcome": "ok", "summary": "long ago"}}
    names = {"t1": "Curation", "t2": "Verify", "t3": "Radar", "t4": "Weekly"}
    items = [item(routine(id=i, name=n), runs[i], logs, {}, now) for i, n in names.items()]
    got = away_lines(items, runs, logs, now - 86400)
    assert [(x["title"], x["summary"], x["count"]) for x in got] == [("Curation", "3 created, 1 merged", 2), ("Radar", "fine", 1)]
    assert {x["kind"] for x in got} == {"routine"} and got[0]["id"] == "t1"
    # A failed latest run is in Needs you, never here, even with ok runs before it.
    logs["c1"] = {"outcome": "failed"}
    runs["t3"].append(run("c0", ago=3600))
    logs["c0"] = {"outcome": "ok", "summary": "earlier"}
    items = [item(routine(id=i, name=n), runs[i], logs, {}, now) for i, n in names.items()]
    assert [x["title"] for x in away_lines(items, runs, logs, now - 86400)] == ["Curation"]
    # A kept log that says an older run failed leaves it out of the count.
    logs["a2"] = {"outcome": "failed"}
    assert away_lines(items, runs, logs, now - 86400)[0]["count"] == 1
