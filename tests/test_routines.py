import time

from orb.routines import allowed_call, call_key, hidden, item, parse_log

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
