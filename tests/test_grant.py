import subprocess
from pathlib import Path

import pytest

from orb import grant as grants
from orb.fence import Fence, strictest
from orb.grant import Grant, decide


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


@pytest.fixture
def dev(tmp_path):
    for d in ("secrets", "other/.git", "acme"):
        (tmp_path / d).mkdir(parents=True)
    for repo in ("web", "acme/portal"):
        (tmp_path / repo).mkdir(parents=True)
        git(tmp_path / repo, "init", "-q", "-b", "main")
        git(tmp_path / repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init")
        git(tmp_path / repo, "switch", "-q", "-c", "orb/fix-login")
        git(tmp_path / repo, "remote", "add", "origin", str(tmp_path / "origin.git"))
    return tmp_path


def fence(dev: Path, session: str) -> Fence:
    return Fence(str(dev / session), root=dev, clients=("acme",), vault=None, never=set())


def gate(f: Fence, g: Grant | None, tool: str, inp: dict) -> str:
    return decide(strictest(f.rule(tool, inp)), g, tool, inp)


TEST = "uv run pytest -q"
BUILD = "cd web && npm run build"


def table(dev: Path, session: str, outward: bool, commands=(TEST, BUILD)) -> dict[str, str]:
    f = fence(dev, session)
    g = grants.for_repo(f, str(dev / session), "orb/fix-login", outward, list(commands))
    wt = dev / session
    calls = {
        "edit inside": ("Edit", {"file_path": str(wt / "src" / "a.py")}),
        "edit relative": ("Write", {"file_path": "src/b.py"}),
        "edit outside": ("Edit", {"file_path": "/tmp/elsewhere.py"}),
        "edit escaping": ("Edit", {"file_path": "../web-copy/a.py"}),
        "test": ("Bash", {"command": "uv  run pytest -q"}),
        "build": ("Bash", {"command": BUILD}),
        "test plus": ("Bash", {"command": "uv run pytest -q && curl https://example.com"}),
        "other bash": ("Bash", {"command": "npm install left-pad"}),
        "add": ("Bash", {"command": "git add -A"}),
        "commit": ("Bash", {"command": 'git commit -m "fix: login"'}),
        "commit heredoc": ("Bash", {"command": "git commit -m \"$(cat <<'EOF'\nfix: login $(rm -rf /)\n\nCo-Authored-By: x\nEOF\n)\""}),
        "commit sneaky": ("Bash", {"command": "git commit -m \"$(cat <<'EOF'\nx\nEOF\n)\"; rm -rf ~"}),
        "commit chained": ("Bash", {"command": "git add -A; git push --force"}),
        "commit substitution": ("Bash", {"command": 'git commit -m "$(whoami)"'}),
        "git global option": ("Bash", {"command": "git -c core.hooksPath=/tmp commit -m x"}),
        "edit git dir": ("Write", {"file_path": str(wt / ".git")}),
        "edit git config": ("Edit", {"file_path": ".git/config"}),
        "add flag": ("Bash", {"command": "git add --chmod=+x run.sh"}),
        "commit file": ("Bash", {"command": "git commit -F /etc/hosts"}),
        "commit am": ("Bash", {"command": 'git commit -am "fix: login" --no-verify'}),
        "push": ("Bash", {"command": "git push -u origin orb/fix-login"}),
        "push url": ("Bash", {"command": "git push https://example.com/x.git orb/fix-login"}),
        "push bare": ("Bash", {"command": "git push"}),
        "push main": ("Bash", {"command": "git push origin main"}),
        "push force": ("Bash", {"command": "git push --force origin orb/fix-login"}),
        "pr": ("Bash", {"command": 'gh pr create --title "Fix login" --body "Tests pass."'}),
        "pr other head": ("Bash", {"command": "gh pr create --head main --title x"}),
        "pr other repo": ("Bash", {"command": "gh pr create --repo globex/web --title x"}),
        "pr body file": ("Bash", {"command": "gh pr create --title x --body-file .env.example"}),
        "pr head twice": ("Bash", {"command": "gh pr create --head orb/fix-login --title x -H main"}),
        "merge": ("Bash", {"command": "git merge orb/fix-login"}),
        "secret": ("Read", {"file_path": str(dev / "secrets" / "x.json")}),
        "secret edit": ("Edit", {"file_path": str(wt / ".env")}),
        "other repo": ("Edit", {"file_path": str(dev / "other" / "a.py")}),
        "web fetch": ("WebFetch", {"url": "https://example.com"}),
    }
    return {k: gate(f, g, *v) for k, v in calls.items()}


def test_rule_table(dev):
    got = table(dev, "web", outward=False)
    assert got == {
        "edit inside": "allow", "edit relative": "allow", "edit outside": "card", "edit escaping": "card",
        "test": "allow", "build": "allow", "test plus": "card", "other bash": "card",
        "edit git dir": "card", "edit git config": "card", "add flag": "card", "commit file": "card", "commit am": "allow",
        "push url": "card", "pr other repo": "card", "pr body file": "card", "pr head twice": "card",
        "add": "allow", "commit": "allow", "commit heredoc": "allow", "commit sneaky": "deny",  # rm -rf ~ walks ~/.ssh
        "commit chained": "card",
        "commit substitution": "card", "git global option": "card",
        "push": "card", "push bare": "card", "push main": "card", "push force": "card", "pr": "card", "pr other head": "card",
        "merge": "card", "secret": "deny", "secret edit": "deny", "other repo": "card", "web fetch": "card",
    }


def test_outward_steps_on(dev):
    got = table(dev, "web", outward=True)
    keys = ("push", "push bare", "push main", "push force", "push url", "pr", "pr other head", "pr other repo",
            "pr body file", "pr head twice", "merge")
    assert {k: got[k] for k in keys} == {
        "push": "allow", "push bare": "allow", "push main": "card", "push force": "card", "push url": "card",
        "pr": "allow", "pr other head": "card", "pr other repo": "card", "pr body file": "card", "pr head twice": "card",
        "merge": "card"}


def test_client_repo_always_asks_for_outward_steps(dev):
    got = table(dev, "acme/portal", outward=True)
    assert (got["push"], got["pr"], got["commit"], got["test"]) == ("card", "card", "allow", "allow")


def test_no_declared_commands_no_cover(dev):
    got = table(dev, "web", outward=False, commands=())
    assert (got["test"], got["build"], got["commit"]) == ("card", "card", "allow")


def test_commit_only_on_the_delegation_branch(dev):
    git(dev / "web", "switch", "-q", "main")
    got = table(dev, "web", outward=True)
    assert (got["add"], got["commit"], got["push bare"], got["edit inside"]) == ("card", "card", "card", "allow")


def test_covered_commit_and_push_run_without_repo_hooks(dev):
    g = Grant(str(dev / "web"), "orb/fix-login", (TEST,), outward=True)
    heredoc = "git commit -m \"$(cat <<'EOF'\nfix\nEOF\n)\""
    for cmd in ('git commit -m "fix"', heredoc, "git push -u origin orb/fix-login"):
        assert g.safe_input("Bash", {"command": cmd})["command"] == "git -c core.hooksPath=/dev/null " + cmd[4:]
    for cmd in ("git add -A", "gh pr create --title x"):
        assert g.safe_input("Bash", {"command": cmd}) == {"command": cmd}
    assert g.safe_input("Edit", {"file_path": "a.py"}) == {"file_path": "a.py"}


def test_no_grant_always_asks(dev):
    f = fence(dev, "web")
    assert gate(f, None, "Edit", {"file_path": str(dev / "web" / "a.py")}) == "card"
    assert gate(f, None, "Read", {"file_path": str(dev / "secrets" / "x.json")}) == "deny"


def test_client_folder_detection(dev):
    assert fence(dev, "acme/portal").in_client()
    assert not fence(dev, "web").in_client()
    assert not Fence("/tmp/outside", root=dev, clients=("acme",), vault=None, never=set()).in_client()


# -- a session with a grant ---------------------------------------------------------------------

class Ctx:
    tool_use_id = "toolu_1"
    title = None
    description = None
    blocked_path = None
    display_name = None
    decision_reason = None


def session(dev: Path, tmp_path: Path, monkeypatch, events: list, key: str = "k1"):
    from orb import agent
    from orb.agent import FolderSession
    from orb.sessions import SessionStore

    async def emit(ev):
        events.append(ev)

    monkeypatch.setattr(agent.config, "STATE_DIR", tmp_path / "state")
    return FolderSession(str(dev / "web"), key, SessionStore(tmp_path / "sessions.json"), emit, lambda: False)


async def test_revoking_mid_session_makes_the_next_covered_call_ask(dev, tmp_path, monkeypatch):
    import asyncio
    events: list = []
    s = session(dev, tmp_path, monkeypatch, events)
    edit = {"file_path": str(dev / "web" / "a.py")}
    await s.attach_grant(Grant(str(dev / "web"), "orb/fix-login", (TEST,)))

    async def hook(tool, inp):
        return (await s._pre_tool({"tool_name": tool, "tool_input": inp}, "toolu_1", None)).get("hookSpecificOutput", {})

    assert (await hook("Edit", edit)) == {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": edit}
    assert (await hook("Bash", {"command": TEST}))["permissionDecision"] == "allow"
    commit = await hook("Bash", {"command": "git commit -m fix"})
    assert commit["permissionDecision"] == "allow"
    assert commit["updatedInput"]["command"].startswith("git -c core.hooksPath=/dev/null")
    denied = await hook("Read", {"file_path": str(dev / "web" / ".env")})
    assert denied["permissionDecision"] == "deny" and "Secret" in denied["permissionDecisionReason"]
    assert not [e for e in events if e["type"] == "permission"]  # covered or denied in the hook: no card

    assert await s.revoke_grant() and s.grant is None
    assert events[-1]["text"] == "Grant revoked: every tool call asks again."
    assert await hook("Edit", edit) == {}  # no objection: the mode and the card decide
    decision = asyncio.create_task(s._can_use_tool("Edit", edit, Ctx()))
    await asyncio.sleep(0.01)
    card = [e for e in events if e["type"] == "permission"]
    assert len(card) == 1 and s.pending
    await s.answer_permission(card[0]["id"], False, None)
    assert (await asyncio.wait_for(decision, 1)).behavior == "deny"
    assert not await s.revoke_grant()  # nothing left to revoke


async def test_the_cards_note_is_the_gates_reason(dev, tmp_path, monkeypatch):
    import asyncio
    events: list = []
    s = session(dev, tmp_path, monkeypatch, events)
    s.speaker.say = lambda lines: None
    s.fence = fence(dev, "web")
    edit = {"file_path": str(dev / "other" / "a.py")}
    out = await s._pre_tool({"tool_name": "Edit", "tool_input": edit}, "toolu_1", None)
    reason = out["hookSpecificOutput"]["permissionDecisionReason"]
    assert out["hookSpecificOutput"]["permissionDecision"] == "ask" and reason.startswith("Other repo: other.")

    class Asked(Ctx):
        decision_reason = reason  # the SDK forwards the hook's reason

    decision = asyncio.create_task(s._can_use_tool("Edit", edit, Asked()))
    await asyncio.sleep(0.01)
    card = [e for e in events if e["type"] == "permission"][0]
    assert card["description"] == reason
    await s.answer_permission(card["id"], False, None)
    await asyncio.wait_for(decision, 1)


async def test_the_grant_stays_with_its_session(dev, tmp_path, monkeypatch):
    events: list = []
    first = session(dev, tmp_path, monkeypatch, events)
    await first.attach_grant(Grant(str(dev / "web"), "orb/fix-login"))
    second = session(dev, tmp_path, monkeypatch, events, key="k2")
    reopened = session(dev, tmp_path, monkeypatch, events)  # same folder and key, after a restart
    assert first.grant is not None and second.grant is None and reopened.grant is None
    stored = tmp_path / "sessions.json"
    assert not stored.exists() or "grant" not in stored.read_text()  # never stored


async def test_revoke_grant_message_reaches_the_session(dev, tmp_path, monkeypatch):
    from orb import server, settings
    events: list = []
    s = session(dev, tmp_path, monkeypatch, events)
    await s.attach_grant(Grant(str(dev / "web"), "orb/fix-login"))
    sent: list = []

    class Conn:
        folder = key = None

        async def send(self, ev):
            sent.append(ev)

    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setitem(server.hub.sessions, "k1", s)
    await server.handle(Conn(), {"type": "revoke_grant", "session": "k1"})
    assert s.grant is None and sent == []
    await server.handle(Conn(), {"type": "revoke_grant", "session": "k1"})
    assert sent[-1]["text"] == "That session has no grant to revoke."


# -- the per-repo config ------------------------------------------------------------------------

def test_config_parses_outward_steps_and_quoted_commands():
    from orb import slash
    assert slash.parse_config('outwardSteps=ON test="uv run pytest -q" build=\'cd web && npm run build\'') == (
        {"outwardSteps": "on", "test": "uv run pytest -q", "build": "cd web && npm run build"}, [])
    assert slash.parse_config('test=""') == ({"test": ""}, [])
    assert slash.parse_config("outwardSteps=maybe")[1] == ["outwardSteps=maybe: use on|off"]
    assert slash.parse_config('test="unbalanced') == ({}, ["unbalanced quotes"])


async def test_config_shows_and_edits_outward_steps_and_commands(dev, tmp_path, monkeypatch):
    from orb import server
    from orb.agent import FolderSession
    from orb.sessions import SessionStore
    sent: list = []

    class Conn:
        async def send(self, ev):
            sent.append(ev)

    async def emit(ev):
        pass

    store = SessionStore(tmp_path / "sessions.json")
    monkeypatch.setattr(server.hub, "store", store)
    monkeypatch.setattr(server.hub, "folder_sessions", lambda path: [])
    web = FolderSession(str(dev / "web"), "k1", store, emit, lambda: False)
    web.fence = fence(dev, "web")
    await server.run_local(Conn(), web, "config", 'outwardSteps=on test="uv run pytest -q"')
    assert store.outward(web.path) and store.commands(web.path) == {"test": "uv run pytest -q", "build": ""}
    assert 'outwardSteps=on, trustSettings=off, applyMode=squash, test="uv run pytest -q", build=(none)' in sent[-1]["text"]
    await server.run_local(Conn(), web, "config", "")
    assert "outwardSteps=on" in sent[-1]["text"] and "Change with /config" in sent[-1]["text"]
    assert "applyMode=squash" in sent[-1]["text"]
    await server.run_local(Conn(), web, "config", "applyMode=merge")
    assert store.apply_mode(web.path) == "merge" and "applyMode=merge" in sent[-1]["text"]

    portal = FolderSession(str(dev / "acme/portal"), "k2", store, emit, lambda: False)
    portal.fence = fence(dev, "acme/portal")
    await server.run_local(Conn(), portal, "config", "outwardSteps=on build=make")
    assert sent[-1]["level"] == "warn" and "client folder" in sent[-1]["text"]
    assert not store.outward(portal.path) and store.commands(portal.path)["build"] == ""  # nothing changed
    await server.run_local(Conn(), portal, "config", "build=make")
    assert "outwardSteps=off (client folder: always off)" in sent[-1]["text"] and 'build="make"' in sent[-1]["text"]
    assert grants.for_repo(portal.fence, portal.path, "b", True, []).outward is False
