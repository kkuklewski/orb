"""open_screen: the server checks the destination and item, and only then do the pages showing the session move."""

import asyncio
import dataclasses
import re
from pathlib import Path

import pytest

from orb import desk, home, jira, navigate, protocol, settings, vikunja
from orb.agent import FolderSession

ROOT = Path(__file__).parent.parent
TASKS = {"tasks": [{"id": 12, "title": "Ship the globex invoice", "project": "acme", "project_id": 3},
                   {"id": 13, "title": "Call acme about the invoice", "project": "", "project_id": 0},
                   {"id": 7, "title": "ACME-7 Fix the login", "project": "acme", "project_id": 3},
                   {"id": 21, "title": "Book the covid-19 booster", "project": "", "project_id": 0}], "total": 4, "url": "http://v"}
NOTES = [{"file": "inbox/Kafka retries.md", "title": "Kafka retries, explained"},
         {"file": "inbox/Ząbki trip.md", "title": "Ząbki trip"}]
SESSIONS = {
    "/r/acme": [{"key": "a1", "label": "Fix the login", "last_used": 3.0}, {"key": "a0", "label": "Fix the login", "last_used": 1.0},
                {"key": "a2", "label": "Write the README", "last_used": 2.0}],
    "/r/globex": [{"key": "g1", "label": "Fix the login page", "last_used": 5.0}],
    "/v": [{"key": "home", "label": "What's on today?", "last_used": 9.0}],
}


@pytest.fixture
def src(tmp_path, monkeypatch):
    monkeypatch.setattr(vikunja, "open_tasks", lambda url, project=None: TASKS)
    monkeypatch.setattr(home, "awaiting_notes", lambda vault: NOTES)
    return desk.Sources(cfg=lambda: {"vikunja_url": "http://v"}, vault=lambda: Path("/v"),
                        folders=lambda: [{"path": "/r/acme", "label": "acme/acme"}, {"path": "/r/globex", "label": "acme/globex"},
                                         {"path": "/v", "label": "notes"}],
                        routines=lambda: [{"id": "trig_1", "name": "inspire"}, {"id": "trig_2", "name": "Gmail morning cleanup"}],
                        sessions=lambda p: SESSIONS.get(p, []))


def go(src, destination, item=None) -> dict:
    ev, _ = navigate.resolve(src, destination, item)
    protocol.SERVER_EVENTS["navigate"].model_validate(ev)  # what the page gets is what the protocol says
    return {k: v for k, v in ev.items() if v not in (None, False)}


def test_each_destination_in_english_and_polish(src):
    for d in navigate.DESTINATIONS:
        assert go(src, d) == {"type": "navigate", "destination": d}
    assert go(src, "sesje")["destination"] == "sessions"
    assert go(src, "Drugi mózg")["destination"] == "brain"
    assert go(src, "zadania")["destination"] == "tasks"
    assert go(src, "ustawienia")["destination"] == "settings"
    assert go(src, "running now") == {"type": "navigate", "destination": "sessions", "running": True}


def test_items_open_that_item(src):
    assert go(src, "brain", "kafka retries") == {"type": "navigate", "destination": "brain", "note": "inbox/Kafka retries.md"}
    assert go(src, "notatki", "zabki")["note"] == "inbox/Ząbki trip.md"  # diacritics optional
    assert go(src, "routines", "the last run of inspire") == {"type": "navigate", "destination": "routines", "routine": "trig_1"}
    assert go(src, "tasks", "#12")["task"] == "12"
    assert go(src, "tasks", "globex invoice")["task"] == "12"
    assert go(src, "tasks", "acme-7")["task"] == "7"
    assert go(src, "tasks", "covid-19")["task"] == "21"  # shaped like an issue key, but no task has it: a title word
    assert go(src, "sessions", "acme fix login") == {"type": "navigate", "destination": "sessions", "folder": "/r/acme", "session": "a1"}
    assert go(src, "sessions", "readme")["session"] == "a2"
    assert go(src, "sessions", "globex")["session"] == "g1"  # just the repo: its newest session
    assert go(src, "sessions", "running now")["running"] is True
    assert go(src, "routines", "failed") == {"type": "navigate", "destination": "routines"}  # a state: the list, grouped


def test_a_jira_issue_key_opens_its_task(src, monkeypatch):
    rows = {"tasks": [{"id": 10001, "title": "ACME-12 Fix login", "project": "Acme", "project_id": 3},
                      {"id": 10002, "title": "ACME-1", "project": "Acme", "project_id": 3}], "total": 2, "url": "u"}
    monkeypatch.setattr(jira, "open_tasks", lambda url, project=None: rows)
    jira_src = dataclasses.replace(src, cfg=lambda: {"jira_url": "https://acme.atlassian.net"})
    assert go(jira_src, "tasks", "acme-12")["task"] == "10001"
    assert go(jira_src, "tasks", "ACME-1")["task"] == "10002"  # no summary, and not ACME-12


def test_unknown_or_ambiguous_items_are_refused_with_a_line_to_say(src):
    for dest, item, said in [("brain", "quantum soup", "No note waiting for a verdict matches"),
                             ("routines", "nightly", "No routine matches"),
                             ("tasks", "#99", "No open task matches '#99'"), ("tasks", "ACME-99", "No open task matches 'ACME-99'"),
                             ("tasks", "invoice", "matches several"),
                             ("sessions", "fix login", "matches several sessions"),
                             ("sessions", "what's on today", "No session matches"),  # the Home chat is never a row
                             ("sessions", "ready", "Nothing is Ready"),
                             ("home", "x", "no items"),
                             ("calendar", None, "No screen called"),
                             ("", None, "No screen called")]:
        with pytest.raises(navigate.NavigateError, match=said):
            navigate.resolve(src, dest, item)


def test_chat_never_navigates(src):
    for word in ("chat", "Home chat", "czat"):
        with pytest.raises(navigate.NavigateError, match="not a screen"):
            navigate.resolve(src, word)
    with pytest.raises(navigate.NavigateError, match="not a screen"):
        navigate.resolve(src, "home", "chat")


def test_vikunja_down_is_said_and_nothing_moves(src, monkeypatch):
    monkeypatch.setattr(vikunja, "open_tasks", lambda url, project=None: (_ for _ in ()).throw(vikunja.VikunjaError("timed out")))
    with pytest.raises(navigate.NavigateError, match="Vikunja not reachable: timed out"):
        navigate.resolve(src, "tasks", "invoice")


def test_the_description_lists_every_glossary_destination_and_state_word():
    text = (ROOT / "GLOSSARY.md").read_text()
    dests = re.search(r"One of the rail's six places: ([^.]+)\.", text).group(1)
    states = re.search(r"\*\*Routine state\*\*:\nThe one word a routine's line shows: (.+?)\. Routines", text, re.S).group(1)
    words = [w.strip() for w in dests.split(",")]
    words += [re.sub(r" \(.*", "", w).strip() for w in states.replace("\n", " ").split(", ")]
    words += ["Running now", "Finished", "Ready", "Needs you", "Delegated", "Queued"]
    for w in words:
        assert f'"{w.lower()}"' in navigate.DESCRIPTION.lower() or w.lower() in navigate.DESTINATIONS, w
    assert "chat" in navigate.DESCRIPTION and "never call this" in navigate.DESCRIPTION


def make(path, nav=None, handoff=None):
    class Store:
        def resume_id(self, f, k):
            return None

        def mode(self, f, d="default"):
            return d

        def model(self, f, d="sonnet"):
            return d

        def trusted(self, f):
            return False

    async def noop(ev):
        pass
    return FolderSession(path, "k1", Store(), noop, lambda: False, navigate=nav, handoff=handoff)


def test_every_session_gets_the_tool_and_it_needs_no_card(tmp_path, monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path / "v"))

    async def nav(s, d, i):
        return "ok"
    o = make("/r/acme", nav)._options()
    assert navigate.TOOL in o.allowed_tools and "orb" in o.mcp_servers  # pre-allowed: never an approval card
    assert "# Moving the page" in o.system_prompt["append"]
    assert navigate.TOOL not in o.hooks["PreToolUse"][0].matcher  # no fence or card hook either
    assert make("/r/acme")._options().mcp_servers == {}  # no hub, no tool


def test_the_tool_returns_the_line_or_the_refusal(tmp_path, monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path / "v"))
    calls = []

    async def nav(s, d, i):
        calls.append((d, i))
        if d == "chat":
            raise navigate.NavigateError("Chat is not a screen")
        return "The page now shows Sessions."
    t = make("/r/acme", nav)._navigate_tool()
    assert t.name == navigate.NAME and t.annotations.read_only_hint
    ok = asyncio.run(t.handler({"destination": "sesje"}))
    assert not ok["is_error"] and ok["content"][0]["text"] == "The page now shows Sessions."
    bad = asyncio.run(t.handler({"destination": "chat", "item": ""}))
    assert bad["is_error"] and "not a screen" in bad["content"][0]["text"]
    assert calls == [("sesje", None), ("chat", None)]


def test_the_hub_moves_only_the_pages_showing_that_session(src, monkeypatch):
    from orb import server
    sent: list[tuple[str, dict]] = []

    class Conn:
        def __init__(self, key):
            self.key = key

        async def send(self, ev):
            sent.append((self.key, ev))

    hub = server.Hub()
    hub.desk = src
    hub.conns.update({Conn("k1"), Conn("k1"), Conn("other")})
    s = make("/r/acme")
    s.key = "k1"
    out = asyncio.run(hub.navigate(s, "routines", "inspire"))
    assert "Routines › inspire" in out
    assert [k for k, _ in sent] == ["k1", "k1"]
    assert sent[0][1] == {"type": "navigate", "destination": "routines", "running": False, "folder": None, "session": None,
                          "note": None, "task": None, "routine": "trig_1"}
    sent.clear()
    with pytest.raises(navigate.NavigateError):
        asyncio.run(hub.navigate(s, "routines", "nightly"))
    assert sent == []  # refused: nothing moves
    s.key = "nobody"
    with pytest.raises(navigate.NavigateError, match="No page shows this session"):
        asyncio.run(hub.navigate(s, "home", None))
