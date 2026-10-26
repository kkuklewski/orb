"""Delegations end to end against a throwaway repo: card, Allow, stages, Review, Apply, conflict, Undo, Discard."""

import asyncio
import hashlib
import os
import subprocess
from pathlib import Path

import pytest

from orb import config, delegation, folders, needs
from orb import worktree as wts
from orb.delegation import DelegationError, Delegator
from orb.fence import Fence
from orb.sessions import SessionStore

ID = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t",
      "GIT_COMMITTER_EMAIL": "t@example.com"}
TASK = {"id": 7, "title": "Fix the login button", "project": "Acme web", "project_id": 3, "due": None,
        "url": "http://tracker.example/tasks/7", "description": "The button does nothing on Safari."}


def git(cwd, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True,
                         env={**os.environ, **ID})
    return out.stdout.strip()


def commit(cwd, files: dict[str, str], msg: str) -> str:
    for name, text in files.items():
        (Path(cwd) / name).write_text(text)
    git(cwd, "add", "-A")
    git(cwd, "commit", "-q", "-m", msg)
    return git(cwd, "rev-parse", "HEAD")


def fingerprint(repo: Path) -> dict:
    files = {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(repo.rglob("*")) if p.is_file() and ".git" not in p.relative_to(repo).parts}
    return {"files": files, "head": git(repo, "rev-parse", "HEAD"), "branch": git(repo, "branch", "--show-current"),
            "status": git(repo, "status", "--porcelain=v1", "--untracked-files=all")}


class FakeSession:
    def __init__(self, path: str, root: Path) -> None:
        self.path, self.grant, self.sent, self.closed, self.pending = path, None, [], False, {}
        self.busy, self.interrupted = False, 0
        self.fence = Fence(path, root=root, clients=("acme",), vault=None, never=set())

    async def attach_grant(self, g) -> None:
        self.grant = g

    async def revoke_grant(self) -> None:
        self.grant = None

    async def send(self, text: str, kind: str) -> None:
        self.sent.append((text, kind))

    async def close(self) -> None:
        self.closed = True

    async def interrupt(self) -> None:
        self.interrupted += 1
        self.busy = False


@pytest.fixture
def dev(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STATE_DIR", tmp_path / "state")
    web = tmp_path / "dev" / "web"
    web.mkdir(parents=True)
    git(web, "init", "-q", "-b", "main")
    commit(web, {"a.txt": "a\n", "c.txt": "one\ntwo\nthree\n"}, "init")
    return tmp_path


class Rig:
    """A Delegator with a real store and worktrees, fake sessions, and what it pushed and marked done."""

    def __init__(self, dev: Path, test: str = "") -> None:
        self.dev, self.web = dev, str(dev / "dev" / "web")
        self.store = SessionStore(dev / "state" / "sessions.json")
        if test:
            self.store.set_command(self.web, "test", test)
        self.sessions: dict[str, FakeSession] = {}
        self.pushed: list[dict] = []
        self.marked: list[tuple[int, bool]] = []
        self.d = self.make()

    def make(self) -> Delegator:
        async def push(ev):
            self.pushed.append(ev)

        async def done(task, on):
            self.marked.append((task, on))

        return Delegator(self.dev / "state" / "delegations.json", store=self.store, push=push, done=done,
                         session=lambda path, key: self.sessions.setdefault(key, FakeSession(path, self.dev / "dev")))

    async def settle(self) -> None:
        while self.d.jobs:
            await asyncio.gather(*list(self.d.jobs))

    def stages(self) -> list[str]:
        return [ev["items"][0]["stage"] for ev in self.pushed if ev["items"]]

    def row(self) -> dict:
        return self.d.event()["items"][0]

    async def allow(self, task: dict = TASK) -> dict:
        card = self.d.card(task, self.web, "web")
        (r,) = await self.d.confirm(card["id"], True, {"secrets"})
        await self.settle()
        return r

    async def turn(self, files: dict[str, str] | None = None, r: dict | None = None) -> None:
        r = r or next(iter(self.d.items.values()))
        if files:
            commit(r["worktree"], files, "work")
        await self.d.on_event(r["session"], {"type": "result"})
        await self.settle()


async def test_delegate_raises_the_grant_card_and_deny_starts_nothing(dev):
    rig = Rig(dev, test="uv run pytest -q")
    card = rig.d.card(TASK, rig.web, "web")
    assert card["type"] == "delegate_card" and card["task"] == 7 and card["repo"] == "web"
    assert card["branch"] == wts.branch_name(7, TASK["title"])
    assert card["covers"] == ["Edit files in its own worktree", "Run the test command: uv run pytest -q",
                              f"git add and git commit on {card['branch']}",
                              "Push and a PR: Orb asks you after the tests pass"]
    assert "No test or build command declared" in delegation.covers("b", {"test": "", "build": ""})[1]

    assert await rig.d.confirm(card["id"], False) is None
    assert rig.d.items == {} and rig.sessions == {} and rig.pushed == [] and wts.registered() == {}
    with pytest.raises(DelegationError, match="card is gone"):
        await rig.d.confirm(card["id"], True)


async def test_allow_starts_a_session_in_its_own_worktree_and_leaves_the_checkout_alone(dev):
    rig = Rig(dev, test="true")
    (Path(rig.web) / "a.txt").write_text("a, mine\n")  # the owner's uncommitted work
    before = fingerprint(Path(rig.web))

    r = await rig.allow()

    assert fingerprint(Path(rig.web)) == before
    assert Path(r["worktree"]).is_dir() and (Path(r["worktree"]) / "a.txt").read_text() == "a, mine\n"
    assert r["stage"] == "working" and r["task"] == 7 and r["branch"].startswith("orb/7-")
    s = rig.sessions[r["session"]]
    assert s.path == r["worktree"] and s.grant.branch == r["branch"] and s.grant.outward is False
    assert s.grant.commands == ("true",)
    assert len(s.sent) == 1 and "Fix the login button" in s.sent[0][0] and "Don't push" in s.sent[0][0]
    assert rig.row()["line"] == "Working" and rig.row()["folder"] == r["worktree"]
    assert rig.d.folder(r["worktree"]) == r["worktree"]
    assert (dev / "state" / "delegations.json").stat().st_mode & 0o777 == 0o600
    with pytest.raises(DelegationError, match="already delegated"):
        rig.d.card(TASK, rig.web, "web")


async def test_a_delegation_is_not_a_folder_in_the_roots(dev):
    rig = Rig(dev)
    r = await rig.allow()
    listed = [f.path for f in folders.discover(dev / "dev")]
    assert str(Path(rig.web).resolve()) in [str(Path(p).resolve()) for p in listed]
    assert not any(str(Path(p).resolve()) == r["worktree"] for p in listed)


async def test_a_turn_runs_the_tests_and_the_stages_come_in_order(dev):
    rig = Rig(dev, test="true")
    await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.stages() == ["working", "testing", "ready"]
    assert rig.row()["line"] == f"Ready: branch {rig.row()['branch']}, tests passed"


async def test_ready_without_a_declared_test_says_so(dev):
    rig = Rig(dev)
    await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["line"].endswith(", no tests declared")


async def test_failing_tests_no_commits_or_uncommitted_work_are_not_ready(dev):
    rig = Rig(dev, test="echo collected 3; echo 'FAILED tests/test_x.py::test_login'; exit 1")
    r = await rig.allow()
    await rig.turn()
    assert rig.row()["stage"] == "failed" and rig.row()["line"] == f"No commits on branch {r['branch']}"
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["line"] == "Tests failed: FAILED tests/test_x.py::test_login"
    (Path(r["worktree"]) / "loose.txt").write_text("x\n")
    await rig.turn()
    assert rig.row()["line"] == f"Uncommitted changes on branch {r['branch']}"


async def test_caches_a_test_run_leaves_are_not_uncommitted_work(dev):
    rig = Rig(dev)
    r = await rig.allow()
    wt = Path(r["worktree"])
    commit(wt, {"d.txt": "delegated\n"}, "work")
    for p in ("__pycache__/a.cpython-314.pyc", "src/__pycache__/b.pyc", ".pytest_cache/v/x", "node_modules/.bin/y", "c.pyc"):
        (wt / p).parent.mkdir(parents=True, exist_ok=True)
        (wt / p).write_text("x")
    await rig.turn()
    assert rig.row()["stage"] == "ready"
    (wt / "src" / "new.py").write_text("x\n")  # a new file the session forgot to commit still counts
    await rig.turn()
    assert rig.row()["line"] == f"Uncommitted changes on branch {r['branch']}"


async def test_a_waiting_card_shows_on_the_line(dev):
    rig = Rig(dev)
    rig.d.waiting = lambda key: "Run make deploy"
    r = await rig.allow()
    await rig.d.on_event(r["session"], {"type": "permission"})
    row = rig.pushed[-1]["items"][0]
    assert row["line"] == "Waiting for your OK"
    assert row["needs"] == "card" and row["ask"] == "Run make deploy"  # Needs you shows it with the delegation's name
    assert row["task"] == 7 and row["title"] == TASK["title"] and row["repo"] == "web"
    rig.d.waiting = lambda key: ""
    assert rig.row()["needs"] is None and rig.row()["ask"] is None
    await rig.d.on_event("someone-else", {"type": "result"})
    assert rig.row()["stage"] == "working"


async def test_review_sends_the_diff(dev):
    rig = Rig(dev)
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    sent: list = []

    async def send(ev):
        sent.append(ev)

    await rig.d.diff(r["id"], send)
    assert sent[0]["type"] == "delegation_diff" and sent[0]["branch"] == r["branch"]
    assert "d.txt" in sent[0]["diff"] and "+delegated" in sent[0]["diff"]


async def test_apply_lands_the_branch_marks_the_task_done_and_removes_the_worktree(dev):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["apply_text"] == f"Apply merges branch {r['branch']} and marks task #7 done."
    head = git(rig.web, "rev-parse", "HEAD")
    s = rig.sessions[r["session"]]

    await rig.d.apply(r["id"], rig.store.apply_mode)

    assert s.closed and s.grant is None
    assert git(rig.web, "rev-parse", "HEAD^") == head and (Path(rig.web) / "d.txt").read_text() == "delegated\n"
    assert "(task #7)" in git(rig.web, "log", "-1", "--format=%s")
    assert rig.marked == [(7, True)] and not Path(r["worktree"]).exists()
    assert r["worktree"] not in rig.store.data and rig.d.folder(r["worktree"]) is None
    assert rig.row()["stage"] == "applied" and rig.row()["line"] == "Applied to main; task #7 done."

    await rig.d.revert(r["id"])
    assert not (Path(rig.web) / "d.txt").exists() and rig.marked[-1] == (7, False)
    assert rig.row()["line"] == "Reverted; task #7 reopened."
    assert await rig.d.discard(r["id"]) == [] and rig.d.event()["items"] == []  # Dismiss


async def test_a_conflict_changes_nothing_and_says_which_files(dev):
    rig = Rig(dev)
    r = await rig.allow()
    await rig.turn({"c.txt": "one\nTWO (delegated)\nthree\n"})
    commit(rig.web, {"c.txt": "one\nTWO (owner)\nthree\n"}, "ours")
    before = fingerprint(Path(rig.web))

    await rig.d.apply(r["id"], rig.store.apply_mode)

    assert fingerprint(Path(rig.web)) == before and rig.marked == []
    assert rig.row()["stage"] == "ready" and "c.txt" in rig.row()["conflict"]
    assert Path(r["worktree"]).is_dir()
    with pytest.raises(DelegationError, match="Only an applied"):
        await rig.d.revert(r["id"])


async def test_apply_refuses_before_ready(dev):
    rig = Rig(dev)
    r = await rig.allow()
    with pytest.raises(DelegationError, match="Only a Ready"):
        await rig.d.apply(r["id"], rig.store.apply_mode)
    assert not rig.sessions[r["session"]].closed


async def test_discard_stops_the_session_and_drops_the_branch_and_worktree(dev):
    rig = Rig(dev)
    r = await rig.allow()
    await rig.turn({"d.txt": "half done\n"})
    before = fingerprint(Path(rig.web))

    assert await rig.d.discard(r["id"]) == []

    assert rig.sessions[r["session"]].closed and not Path(r["worktree"]).exists()
    assert git(rig.web, "branch", "--list", r["branch"]) == "" and fingerprint(Path(rig.web)) == before
    assert rig.d.items == {} and rig.pushed[-1] == {"type": "delegations", "items": []}
    assert r["worktree"] not in rig.store.data and rig.marked == []


async def test_a_restart_stops_a_running_delegation(dev):
    rig = Rig(dev)
    r = await rig.allow()
    again = rig.make()
    assert again.items[r["id"]]["stage"] == "stopped"
    assert again.event()["items"][0]["line"] == "Stopped by restart"
    rig.d = again  # a new turn (the owner reopened the session) checks it again
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["stage"] == "ready"


async def test_a_restart_waits_in_needs_you_and_resume_continues_the_same_session(dev):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    rig.d.items[r["id"]]["stage"] = "testing"  # a check was running when the server went down
    rig.d._save()
    rig.sessions.clear()  # the old process is gone

    again = rig.make()
    assert rig.sessions == {} and again.jobs == set()  # nothing starts on boot
    assert again.items[r["id"]]["stage"] == "stopped"
    assert '"stopped"' in (dev / "state" / "delegations.json").read_text()  # persisted
    row = again.event()["items"][0]
    assert (row["line"], row["needs"]) == ("Stopped by restart", "stopped")
    with pytest.raises(DelegationError, match="Only a delegation whose tests failed"):
        await again.retry(r["id"])

    rig.d = again
    await again.resume(r["id"])
    await rig.settle()
    s = rig.sessions[r["session"]]  # the same session key, so its resume id
    assert s.path == r["worktree"] and Path(r["worktree"]).is_dir()
    assert s.grant.branch == r["branch"] and s.grant.commands == ("true",)  # the same grant
    assert len(s.sent) == 1 and "Orb restarted" in s.sent[0][0] and r["branch"] in s.sent[0][0]
    assert rig.row()["stage"] == "working" and rig.row()["needs"] is None
    with pytest.raises(DelegationError, match="Only a delegation stopped by a restart"):
        await again.resume(r["id"])
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["stage"] == "ready"


async def test_a_revoked_grant_stays_revoked_on_resume(dev):
    rig = Rig(dev)
    r = await rig.allow()
    rig.d.revoked(r["session"])
    rig.sessions.clear()
    rig.d = rig.make()
    await rig.d.resume(r["id"])
    await rig.settle()
    assert rig.sessions[r["session"]].grant is None and rig.sessions[r["session"]].sent


async def test_failed_tests_need_you_and_retry_sends_the_fix_request(dev):
    rig = Rig(dev, test="echo 'FAILED tests/test_x.py::test_login'; exit 1")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    row = rig.row()
    assert row["needs"] == "failed" and row["line"] == "Tests failed: FAILED tests/test_x.py::test_login"

    await rig.d.retry(r["id"])
    await rig.settle()
    s = rig.sessions[r["session"]]
    assert "Tests failed: FAILED tests/test_x.py::test_login" in s.sent[-1][0] and "Fix that" in s.sent[-1][0]
    assert s.interrupted == 0 and rig.row()["stage"] == "working" and rig.row()["needs"] is None
    rig.store.set_command(rig.web, "test", "true")
    await rig.turn()
    assert rig.row()["stage"] == "ready"


async def test_a_quiet_working_delegation_reads_stuck_and_retry_stops_the_turn_first(dev, monkeypatch):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.d.tick()
    assert rig.row()["line"] == "Working" and rig.d.stuck == set()
    clock = [delegation.time.time() + delegation.STUCK + 1]
    monkeypatch.setattr(delegation.time, "time", lambda: clock[0])
    n = len(rig.pushed)
    await rig.d.tick()
    assert len(rig.pushed) == n + 1  # told once
    row = rig.pushed[-1]["items"][0]
    assert (row["line"], row["needs"]) == ("Stuck 20 min", "stuck")
    await rig.d.tick()
    assert len(rig.pushed) == n + 1
    rig.d.waiting = lambda key: "Run make deploy"  # waiting for you is not stuck
    assert rig.row()["needs"] == "card"
    rig.d.waiting = lambda key: ""

    s = rig.sessions[r["session"]]
    s.busy = True
    await rig.d.retry(r["id"])
    await rig.settle()
    assert s.interrupted == 1 and "Nothing happened in this session for 20 minutes" in s.sent[-1][0]
    assert rig.row()["line"] == "Working" and rig.d.stuck == set()
    await rig.d.on_event(r["session"], {"type": "result"})  # the stopped turn's end: no check
    assert rig.row()["stage"] == "working"
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["stage"] == "ready"


async def test_a_stuck_delegation_that_moves_again_is_working(dev, monkeypatch):
    rig = Rig(dev)
    r = await rig.allow()
    clock = [delegation.time.time() + delegation.STUCK + 1]
    monkeypatch.setattr(delegation.time, "time", lambda: clock[0])
    await rig.d.tick()
    assert rig.row()["needs"] == "stuck"
    await rig.d.on_event(r["session"], {"type": "assistant"})
    assert rig.pushed[-1]["items"][0]["line"] == "Working" and rig.d.stuck == set()


def test_the_failing_line_is_the_first_that_says_so():
    assert delegation.failing_line("ok\nFAILED a\nERROR b\n") == "FAILED a"
    assert delegation.failing_line("just\nthe end\n") == "the end"
    assert delegation.failing_line("") == "no output"


def test_plan_items_carry_the_repo_and_delegate_but_note_tasks_do_not():
    tasks = [{"id": 7, "title": "Fix it", "project": "Acme web", "repo": "web", "due": None, "priority": 3}]
    notes = [{"file": "inbox/n.md", "line": 2, "text": "Call Globex", "mtime": 0}]
    items = needs.queue(tasks, notes, None, None, 0, "2026-10-25")
    task = next(i for i in items if i["kind"] == "task")
    note = next(i for i in items if i["kind"] == "note_task")
    assert "delegate" in task["actions"] and task["repo"] == "web"
    assert "delegate" not in note["actions"]


# -- the page messages --------------------------------------------------------------------------

class Conn:
    folder = key = None

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, ev):
        self.sent.append(ev)


async def test_delegate_message_maps_the_repo_or_asks_for_one(dev, monkeypatch):
    from orb import server, settings, vikunja
    rig = Rig(dev)
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setattr(server.hub, "delegator", rig.d)
    monkeypatch.setattr(server.hub, "allowed_folder", lambda p: Path(p) if p == rig.web else None)
    monkeypatch.setattr(server.hub, "label", lambda p: "web")
    monkeypatch.setattr(vikunja, "task", lambda url, tid: {**TASK, "id": tid})
    mapped: dict = {}
    monkeypatch.setattr(vikunja, "repo_path", lambda vault, pid: mapped.get(pid))

    conn = Conn()
    await server.handle(conn, {"type": "delegate", "task": 7})
    assert conn.sent[-1] == {"type": "error", "text": "Choose the repo to work in."}
    await server.handle(conn, {"type": "delegate", "task": 7, "path": str(dev / "elsewhere")})
    assert conn.sent[-1] == {"type": "error", "text": "Its repo isn't an allowed folder here."}
    await server.handle(conn, {"type": "delegate", "task": 7, "path": rig.web})  # the picker
    assert conn.sent[-1]["type"] == "delegate_card" and conn.sent[-1]["repo"] == "web"
    rig.d.cards.clear()
    mapped[3] = rig.web
    await server.handle(conn, {"type": "delegate", "task": 7})
    card = conn.sent[-1]
    assert card["type"] == "delegate_card"

    await server.handle(conn, {"type": "delegate_confirm", "id": card["id"], "ok": False})
    assert rig.d.items == {}
    await server.handle(conn, {"type": "delegation_apply", "id": "nope"})
    assert conn.sent[-1] == {"type": "error", "text": "That delegation is gone."}
    for t in ("delegation_retry", "delegation_resume"):
        await server.handle(conn, {"type": t, "id": "nope"})
        assert conn.sent[-1] == {"type": "error", "text": "That delegation is gone."}


# -- the queue (#773) ---------------------------------------------------------------------------

def task(n: int) -> dict:
    return {**TASK, "id": n, "title": f"Task {n}", "url": f"http://tracker.example/tasks/{n}"}


async def queue_of(rig: Rig, n: int) -> list[dict]:
    """`n` delegations allowed one after another (limit 3 by default)."""
    return [await rig.allow(task(i)) for i in range(1, n + 1)]


def lines(rig: Rig) -> dict[int, str]:
    return {x["task"]: x["line"] for x in rig.d.event()["items"]}


async def test_past_the_limit_a_delegation_waits_as_queued_and_starts_in_order(dev):
    rig = Rig(dev)
    rs = await queue_of(rig, 5)
    assert lines(rig) == {1: "Working", 2: "Working", 3: "Working", 4: "Queued · 1st", 5: "Queued · 2nd"}
    assert [r["session"] in rig.sessions for r in rs] == [True, True, True, False, False]  # no session yet
    assert all(Path(r["worktree"]).is_dir() for r in rs) and rig.row()["needs"] is None
    assert [x["needs"] for x in rig.d.event()["items"]] == [None] * 5

    await rig.turn({"d.txt": "one\n"}, rs[0])  # Ready frees a slot: the 1st queued starts with its brief
    assert lines(rig)[1].startswith("Ready") and (lines(rig)[4], lines(rig)[5]) == ("Working", "Queued · 1st")
    s = rig.sessions[rs[3]["session"]]
    assert len(s.sent) == 1 and "#4 Task 4" in s.sent[0][0] and s.grant.branch == rs[3]["branch"]


async def test_the_limit_comes_from_settings_and_defaults_to_three(dev, monkeypatch):
    from orb import settings
    assert settings.DEFAULTS["delegation_limit"] == 3
    rig = Rig(dev)
    rig.d.limit = lambda: 1
    await queue_of(rig, 2)
    assert lines(rig) == {1: "Working", 2: "Queued · 1st"}


async def test_failed_stuck_and_discarded_each_start_the_next_queued(dev, monkeypatch):
    rig = Rig(dev, test="exit 1")
    rig.d.limit = lambda: 1
    rs = await queue_of(rig, 4)
    await rig.turn({"d.txt": "x\n"}, rs[0])  # failed
    assert lines(rig) == {1: "Tests failed: no output", 2: "Working", 3: "Queued · 1st", 4: "Queued · 2nd"}

    clock = [delegation.time.time() + delegation.STUCK + 1]
    monkeypatch.setattr(delegation.time, "time", lambda: clock[0])
    await rig.d.tick()  # stuck
    assert (lines(rig)[2], lines(rig)[3], lines(rig)[4]) == ("Stuck 20 min", "Working", "Queued · 1st")

    clock[0] += 1
    assert await rig.d.discard(rs[2]["id"]) == []  # discarded
    assert lines(rig) == {1: "Tests failed: no output", 2: "Stuck 20 min", 4: "Working"}


async def test_discarding_a_queued_delegation_starts_nothing(dev):
    rig = Rig(dev)
    rig.d.limit = lambda: 1
    rs = await queue_of(rig, 3)
    assert await rig.d.discard(rs[1]["id"]) == []
    await rig.settle()
    assert rs[1]["session"] not in rig.sessions and not Path(rs[1]["worktree"]).exists()
    assert lines(rig) == {1: "Working", 3: "Queued · 1st"} and rs[2]["session"] not in rig.sessions


async def test_retry_and_resume_take_the_queue_and_a_restart_stops_queued_ones(dev):
    rig = Rig(dev, test="exit 1")
    rig.d.limit = lambda: 1
    rs = await queue_of(rig, 2)
    await rig.turn({"d.txt": "x\n"}, rs[0])  # 1 failed, 2 starts
    await rig.d.retry(rs[0]["id"])
    assert lines(rig) == {1: "Queued · 1st", 2: "Working"}
    assert len(rig.sessions[rs[0]["session"]].sent) == 1  # the fix request waits for its slot

    again = rig.make()  # a restart: nothing runs or starts
    assert {r["stage"] for r in again.items.values()} == {"stopped"}
    rig.d, rig.sessions, again.limit = again, {}, (lambda: 1)
    await again.resume(rs[1]["id"])
    await again.resume(rs[0]["id"])  # it was queued: the fix request it never got goes first
    await rig.settle()
    assert lines(rig) == {1: "Queued · 1st", 2: "Working"}
    await rig.turn({"d.txt": "y\n"}, again.items[rs[1]["id"]])
    s = rig.sessions[rs[0]["session"]]
    assert len(s.sent) == 1 and "Fix that" in s.sent[0][0]


async def test_bulk_one_card_per_repo_in_order_and_deny_skips_that_repo(dev, monkeypatch):
    from orb import server, settings, vikunja
    api = dev / "dev" / "api"
    api.mkdir()
    git(api, "init", "-q", "-b", "main")
    commit(api, {"a.txt": "a\n"}, "init")
    rig = Rig(dev)
    rig.d.limit = lambda: 2
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setattr(server.hub, "delegator", rig.d)
    allowed = {rig.web: "web", str(api): "api"}
    monkeypatch.setattr(server.hub, "allowed_folder", lambda p: Path(p) if p in allowed else None)
    monkeypatch.setattr(server.hub, "label", lambda p: allowed[p])
    projects = {1: 3, 2: 4, 3: 3, 4: 5, 5: 3}  # project 4 -> api, 5 -> no repo
    monkeypatch.setattr(vikunja, "task", lambda url, tid: {**task(tid), "project_id": projects[tid]})
    monkeypatch.setattr(vikunja, "repo_path", lambda vault, pid: {3: rig.web, 4: str(api)}.get(pid))

    conn = Conn()
    await server.handle(conn, {"type": "delegate_bulk", "tasks": [1, 2, 3, 4, 5]})
    assert conn.sent[0] == {"type": "notice", "level": "warn", "text": "Task #4 has no repo here."}
    web = conn.sent[-1]
    assert (web["type"], web["repo"], web["more"]) == ("delegate_card", "web", 1)
    assert [x["task"] for x in web["rows"]] == [1, 3, 5]
    assert web["covers"][-2] == "git add and git commit on each task's own branch"

    await server.handle(conn, {"type": "delegate_confirm", "id": web["id"], "ok": True})
    await rig.settle()
    card = conn.sent[-1]
    assert (card["type"], card["repo"], card["more"], [x["task"] for x in card["rows"]]) == ("delegate_card", "api", 0, [2])
    assert lines(rig) == {1: "Working", 3: "Working", 5: "Queued · 1st"}

    await server.handle(conn, {"type": "delegate_confirm", "id": card["id"], "ok": False})
    assert conn.sent[-1] is card and sorted(lines(rig)) == [1, 3, 5]

    await server.handle(conn, {"type": "delegate_bulk", "tasks": [1, 2]})  # 1 is already delegated: skipped, named
    assert conn.sent[-2]["text"] == "Task #1 is already delegated." and conn.sent[-1]["repo"] == "api"
    rig.d.cards.clear()
    await server.handle(conn, {"type": "delegate_bulk", "tasks": [4]})  # nothing left to ask about
    assert conn.sent[-1] == {"type": "notice", "level": "warn", "text": "Task #4 has no repo here."}


# -- outward steps (#771) -----------------------------------------------------------------------

@pytest.fixture
def remote(dev):
    """A bare remote as the checkout's upstream (origin/main)."""
    bare = dev / "remote.git"
    git(dev, "init", "-q", "--bare", "-b", "main", str(bare))
    web = dev / "dev" / "web"
    git(web, "remote", "add", "origin", str(bare))
    git(web, "push", "-q", "-u", "origin", "main")
    return bare


def on_remote(bare: Path) -> list[str]:
    return git(bare, "for-each-ref", "--format=%(refname:short)", "refs/heads").split()


class FakeGh:
    def __init__(self, fail: str = "") -> None:
        self.calls: list[tuple] = []
        self.fail = fail

    async def __call__(self, repo, branch, into, title, body):
        self.calls.append((branch, into, title, body))
        if self.fail:
            raise DelegationError(self.fail)
        return 12, "https://git.example/acme/web/pull/12"


@pytest.fixture
def gh(monkeypatch):
    fake = FakeGh()
    monkeypatch.setattr(delegation, "open_pr", fake)
    return fake


async def test_after_the_tests_pass_a_card_asks_before_any_push_and_skip_never_contacts_the_remote(dev, remote, gh):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    row = rig.row()
    assert (row["stage"], row["needs"]) == ("ready", "outward")
    assert row["ask"] == f"Push branch {r['branch']} and open a PR for task #7?"
    assert row["line"] == f"Ready: branch {r['branch']}, tests passed"
    assert row["apply_text"] == f"Apply merges branch {r['branch']} and marks task #7 done."
    assert on_remote(remote) == ["main"] and gh.calls == []

    await rig.d.outward(r["id"], False)  # Skip
    row = rig.row()
    assert (row["stage"], row["needs"], row["ask"], row["pr"]) == ("ready", None, None, None)
    assert on_remote(remote) == ["main"] and gh.calls == []
    with pytest.raises(DelegationError, match="nothing waiting to be pushed"):
        await rig.d.outward(r["id"], True)


async def test_allow_pushes_the_branch_and_opens_a_pr_named_after_the_task(dev, remote, gh):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    await rig.d.outward(r["id"], True)

    assert on_remote(remote) == ["main", r["branch"]]
    assert git(remote, "rev-parse", r["branch"]) == git(rig.web, "rev-parse", r["branch"])
    ((branch, into, title, body),) = gh.calls
    assert (branch, into, title) == (r["branch"], "main", "Fix the login button")
    assert "Task #7: http://tracker.example/tasks/7" in body
    assert [ev["items"][0]["line"] for ev in rig.pushed[-2:]] == ["Opening PR", "Ready: PR #12, tests passed"]
    row = rig.row()
    assert (row["needs"], row["pr"], row["pr_url"]) == (None, 12, "https://git.example/acme/web/pull/12")
    assert row["apply_text"] == "Apply merges PR #12 and marks task #7 done."

    # Apply and Undo stay local; the PR stays as history
    await rig.d.apply(r["id"], rig.store.apply_mode)
    assert rig.row()["line"] == "Applied to main; task #7 done. PR #12 stays open." and rig.marked == [(7, True)]
    assert on_remote(remote) == ["main", r["branch"]]
    await rig.d.revert(r["id"])
    assert not (Path(rig.web) / "d.txt").exists() and rig.marked[-1] == (7, False)
    assert on_remote(remote) == ["main", r["branch"]]


async def test_a_later_passing_turn_asks_to_push_to_the_same_pr(dev, remote, gh):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    await rig.d.outward(r["id"], True)
    await rig.turn({"d.txt": "delegated, again\n"})
    assert rig.row()["ask"] == f"Push branch {r['branch']} to PR #12?"
    await rig.d.outward(r["id"], True)
    assert len(gh.calls) == 1 and git(remote, "rev-parse", r["branch"]) == git(rig.web, "rev-parse", r["branch"])
    assert rig.row()["line"] == "Ready: PR #12, tests passed"


async def test_a_pr_or_push_failure_stays_ready_with_the_branch_and_says_why(dev, remote, gh):
    gh.fail = "gh pr create failed: no default repo"
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    await rig.d.outward(r["id"], True)
    row = rig.row()
    assert (row["stage"], row["needs"], row["pr"]) == ("ready", None, None)
    assert row["line"] == f"Ready: branch {r['branch']}, tests passed · not pushed: gh pr create failed: no default repo"
    assert row["apply_text"] == f"Apply merges branch {r['branch']} and marks task #7 done."

    gh.fail = ""
    git(rig.web, "remote", "set-url", "origin", str(dev / "gone.git"))
    await rig.turn({"d.txt": "delegated, again\n"})
    await rig.d.outward(r["id"], True)
    assert "not pushed: git push failed" in rig.row()["line"] and gh.calls[-1][0] == r["branch"]  # the first try only
    assert len(gh.calls) == 1


async def test_the_outward_setting_pushes_without_a_card_but_never_in_a_client_folder(dev, remote, gh):
    rig = Rig(dev, test="true")
    rig.store.set_outward(rig.web, True)
    card = rig.d.card(TASK, rig.web, "web")
    assert "After the tests pass, Orb pushes the branch and opens a PR (this repo's outward steps are on)" in card["covers"]
    rig.d.cards.clear()
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["line"] == "Ready: PR #12, tests passed" and r["branch"] in on_remote(remote)

    client = dev / "dev" / "acme" / "site"
    client.mkdir(parents=True)
    git(client, "init", "-q", "-b", "main")
    commit(client, {"a.txt": "a\n"}, "init")
    git(client, "remote", "add", "origin", str(remote))
    rig2 = Rig(dev, test="true")
    rig2.web = str(client)
    rig2.store.set_command(rig2.web, "test", "true")
    rig2.store.set_outward(rig2.web, True)
    r2 = await rig2.allow({**TASK, "id": 8})
    await rig2.turn({"d.txt": "client work\n"}, r2)
    row = next(x for x in rig2.d.event()["items"] if x["task"] == 8)
    assert row["needs"] == "outward" and r2["branch"] not in on_remote(remote)


async def test_no_card_without_a_remote(dev, gh):
    rig = Rig(dev, test="true")
    await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["needs"] is None and rig.d.card(task(9), rig.web, "web")["covers"][-1] == \
        "Push and a PR: Orb asks you after the tests pass"


async def test_a_snapshot_branch_is_never_pushed(dev, remote, gh):
    (dev / "dev" / "web" / "a.txt").write_text("my uncommitted edit\n")
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    row = rig.row()
    assert row["needs"] is None and on_remote(remote) == ["main"] and gh.calls == []
    assert row["line"] == f"Ready: branch {r['branch']}, tests passed · not pushed: it starts from your uncommitted changes"


async def test_no_tests_declared_asks_nothing(dev, remote, gh):
    rig = Rig(dev)
    await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["needs"] is None and rig.row()["line"].endswith(", no tests declared")


async def test_the_card_names_the_owners_unpushed_commits_that_go_along(dev, remote, gh):
    commit(dev / "dev" / "web", {"mine.txt": "mine\n"}, "mine, not pushed")
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    assert rig.row()["ask"] == f"Push branch {r['branch']} and open a PR for task #7? 1 of your commits not on origin/main go along."


async def test_a_restart_while_pushing_asks_again(dev, remote, gh):
    rig = Rig(dev, test="true")
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    rig.d.items[r["id"]]["stage"] = "pushing"
    rig.d._save()
    again = rig.make()
    row = again.event()["items"][0]
    assert (row["stage"], row["needs"]) == ("ready", "outward")


async def test_the_outward_message_reaches_the_delegation(dev, remote, gh, monkeypatch):
    from orb import server, settings
    rig = Rig(dev, test="true")
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setattr(server.hub, "delegator", rig.d)
    r = await rig.allow()
    await rig.turn({"d.txt": "delegated\n"})
    conn = Conn()
    await server.handle(conn, {"type": "delegation_outward", "id": "nope", "allow": True})
    assert conn.sent[-1] == {"type": "error", "text": "That delegation is gone."}
    await server.handle(conn, {"type": "delegation_outward", "id": r["id"], "allow": False})
    assert rig.row()["needs"] is None and on_remote(remote) == ["main"]
