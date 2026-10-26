import json
from pathlib import Path

import pytest

from orb import server, settings
from orb.brain import CAPTURE_TOOL, connector_allowed, connector_env
from orb.fence import Fence


def load(tmp_path: Path, data: dict) -> settings.Settings:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data))
    return settings.Settings(path)


def test_a_new_install_is_a_work_machine_and_an_older_one_stays_personal(tmp_path):
    assert settings.Settings(tmp_path / "none.json")["profile"] == "work"
    assert load(tmp_path, {"onboarded": True})["profile"] == "personal"
    assert load(tmp_path, {"onboarded": True, "profile": "work"})["profile"] == "work"


def test_the_work_profile_keeps_connectors_off_and_speech_on_this_mac(tmp_path):
    s = load(tmp_path, {"profile": "work", "brain": True, "connectors": True, "stt": "browser"})
    assert (s["brain"], s["connectors"], s["stt"]) == (False, False, "parakeet")
    assert s.view()["brain"] is False and s.data["brain"] is True  # saved for a switch back
    s.update({"stt": "browser", "brain": True})
    assert s["stt"] == "parakeet" and s["brain"] is False
    s.update({"profile": "personal"})
    assert (s["brain"], s["connectors"], s["stt"]) == (True, True, "browser")
    assert json.loads((tmp_path / "settings.json").read_text())["profile"] == "personal"


def test_a_new_install_hears_through_a_local_engine(tmp_path):
    assert settings.Settings(tmp_path / "none.json")["stt"] == "parakeet"


@pytest.mark.parametrize("saved, env", [
    ({"profile": "work", "brain": True, "connectors": True}, {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"}),
    ({"profile": "personal"}, {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"}),
    ({"profile": "personal", "brain": True}, {}),
    ({"profile": "personal", "connectors": True}, {}),
])
def test_sessions_get_no_claude_ai_connectors_unless_turned_on(tmp_path, saved, env):
    assert connector_env(load(tmp_path, saved)) == env


def test_brain_alone_lets_only_brain_tools_through(tmp_path):
    brain = load(tmp_path, {"profile": "personal", "brain": True})
    assert connector_allowed("mcp__claude_ai_Brain__search_notes", brain)
    assert connector_allowed(CAPTURE_TOOL, brain)
    assert not connector_allowed("mcp__claude_ai_Acme_Mail__send_message", brain)
    assert connector_allowed("mcp__claude_ai_Acme_Mail__send_message", load(tmp_path, {"profile": "personal", "connectors": True}))
    assert not connector_allowed("mcp__claude_ai_Brain__read_note", load(tmp_path, {"profile": "work", "brain": True}))


@pytest.fixture
def dev(tmp_path):
    for d in ("vault/.git", "mine/.git", "other/.git"):
        (tmp_path / d).mkdir(parents=True)
    return tmp_path


def test_work_fences_every_other_repo_like_a_client_folder(dev, work):
    f = Fence(str(dev / "mine"), root=dev, clients=(), vault=dev / "vault")
    assert f.in_client()
    verdict = f.check_path(str(dev / "other" / "a.py"), write=False)
    assert verdict[0] == "deny" and "own session" in verdict[1]
    assert f.check_path(str(dev / "mine" / "a.py")) is None
    hub = Fence(str(dev / "vault"), root=dev, clients=(), vault=dev / "vault")
    assert hub.check_path(str(dev / "other" / "a.py"), write=False)[0] == "ask"  # the vault session reads, with a card
    assert hub.check_path(str(dev / "other" / "a.py"))[0] == "deny"


def test_personal_asks_before_another_repo(dev):
    f = Fence(str(dev / "mine"), root=dev, clients=(), vault=dev / "vault")
    assert not f.in_client() and f.check_path(str(dev / "other" / "a.py"))[0] == "ask"


def test_work_answers_on_this_mac_only(work):
    assert server.host_ok("127.0.0.1:8765") and not server.host_ok("mbp.example.ts.net")


async def test_a_session_loads_no_connectors_and_its_hook_lets_only_brain_through(monkeypatch):
    from test_navigate import make
    s = make("/r/acme")
    o = s._options()
    assert o.env["ENABLE_CLAUDEAI_MCP_SERVERS"] == "false"
    hook = next(m for m in o.hooks["PreToolUse"] if m.matcher == "mcp__claude_ai_.*").hooks[0]
    monkeypatch.setitem(settings.settings.data, "brain", True)
    assert "ENABLE_CLAUDEAI_MCP_SERVERS" not in s._options().env
    sent = []

    async def emit(ev):
        sent.append(ev)
    monkeypatch.setattr(s, "emit", emit)
    out = await hook({"tool_name": "mcp__claude_ai_Acme_Mail__send_message", "tool_input": {}}, "t1", None)
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny" and sent[0]["level"] == "warn"
    assert await hook({"tool_name": "mcp__claude_ai_Brain__read_note", "tool_input": {}}, "t2", None) == {}
