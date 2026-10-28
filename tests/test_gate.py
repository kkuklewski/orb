import subprocess
from pathlib import Path

import pytest

from orb import desk, handoff, settings
from orb.brain import CAPTURE_TOOL, CaptureGuard
from orb.fence import Fence
from orb.gate import CONNECTORS_OFF, Decision, Gate, hook_output
from orb.grant import Grant
from orb.intake import DropGrant


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


@pytest.fixture
def dev(tmp_path):
    for d in ("secrets", "other/.git"):
        (tmp_path / d).mkdir(parents=True)
    web = tmp_path / "web"
    web.mkdir()
    git(web, "init", "-q", "-b", "main")
    git(web, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init")
    git(web, "switch", "-q", "-c", "orb/fix-login")
    return tmp_path


@pytest.fixture
def connectors(monkeypatch):
    monkeypatch.setitem(settings.settings.data, "brain", True)
    monkeypatch.setitem(settings.settings.data, "connectors", False)


def make(dev: Path, tmp_path: Path, task_title=None) -> Gate:
    f = Fence(str(dev / "web"), root=dev, clients=("acme",), vault=None, never=set())
    return Gate(f, "web#1", str(dev / "web"), CaptureGuard(tmp_path / "captures.json"), task_title)


def test_connector_that_is_off_is_denied(dev, tmp_path, connectors):
    g = make(dev, tmp_path)
    assert g.decide("mcp__claude_ai_Gmail__send", {}) == Decision("deny", CONNECTORS_OFF)
    assert g.decide("mcp__claude_ai_Brain__search_notes", {"query": "acme"}).kind == "pass"


def test_capture_thought_only_with_the_users_words(dev, tmp_path, connectors):
    g = make(dev, tmp_path)
    assert g.decide(CAPTURE_TOOL, {"kind": "thought", "text": "made up"}).kind == "deny"
    g.guard.queue("web#1", "call globex on friday")
    d = g.decide(CAPTURE_TOOL, {"kind": "thought", "text": "Call Globex."})
    assert (d.kind, d.input["text"], d.covered) == ("allow", "call globex on friday", False)


def test_handoff_and_tracker_writes_always_ask(dev, tmp_path):
    g = make(dev, tmp_path, task_title=lambda raw_id: f"Fix login #{raw_id}")
    d = g.decide(handoff.TOOL, {"repo": "globex"})
    assert d.kind == "ask" and "globex" in d.reason
    d = g.decide(desk.WRITE_TOOLS[0], {"id": 7})
    assert (d.kind, d.title) == ("ask", "Fix login #7") and "Fix login #7" in d.reason
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=True)
    assert g.decide(handoff.TOOL, {"repo": "globex"}).kind == "ask"  # a grant never covers them


def test_fence_deny_is_final_even_with_a_grant(dev, tmp_path):
    g = make(dev, tmp_path)
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=False)
    assert g.decide("Read", {"file_path": str(dev / "secrets" / "x.json")}).kind == "deny"
    assert g.decide("Edit", {"file_path": str(dev / "web" / ".env")}).kind == "deny"


def test_fence_ask_is_never_covered(dev, tmp_path):
    g = make(dev, tmp_path)
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=False)
    d = g.decide("Edit", {"file_path": str(dev / "other" / "a.py")})
    assert d.kind == "ask" and not d.covered


def test_a_covered_call_is_allowed_with_its_safe_input(dev, tmp_path):
    g = make(dev, tmp_path)
    edit = {"file_path": str(dev / "web" / "src" / "a.py")}
    assert g.decide("Edit", edit).kind == "pass"  # no grant: the mode and the card decide
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=False)
    assert g.decide("Edit", edit) == Decision("allow", input=edit, covered=True)
    d = g.decide("Bash", {"command": 'git commit -m "fix: login"'})
    assert d.covered and d.input["command"] == 'git -c core.hooksPath=/dev/null commit -m "fix: login"'
    assert g.decide("Bash", {"command": "npm install left-pad"}).kind == "pass"


def test_force_push_is_denied_in_every_session_even_with_a_grant(dev, tmp_path):
    g = make(dev, tmp_path)
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=True)
    d = g.decide("Bash", {"command": "git push --force origin orb/fix-login"})
    assert d.kind == "deny" and d.reason.startswith("Force-push is blocked in Orb")
    assert g.decide("Bash", {"command": "git push --mirror"}).kind == "ask"


def test_a_heredoc_commit_is_covered_whatever_its_message_says(dev, tmp_path):
    g = make(dev, tmp_path)
    g.cover = Grant(str(dev / "web"), "orb/fix-login", (), outward=False)
    cmd = "git commit -m \"$(cat <<'EOF'\nfix: never git push --force\nEOF\n)\""
    assert g.decide("Bash", {"command": cmd}).covered


def test_a_drop_covers_only_its_own_link(dev, tmp_path):
    g = make(dev, tmp_path)
    g.cover = DropGrant(url="https://example.com/post")
    assert g.decide("WebFetch", {"url": "https://example.com/post", "prompt": "x"}).covered
    assert g.decide("WebFetch", {"url": "https://example.com/other", "prompt": "x"}).kind == "pass"


def test_hook_output_shapes():
    assert hook_output(Decision("pass")) == {}
    assert hook_output(Decision("deny", "No.")) == {"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "No."}}
    assert hook_output(Decision("allow", input={"command": "ls"}, covered=True)) == {"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": {"command": "ls"}}}
