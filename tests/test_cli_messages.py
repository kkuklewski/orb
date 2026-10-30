"""The page messages behind Start in CLI (server.py): `item_start` with `where` (or the settings' "start_in") and
`cli_start` for a brief of the page's own; the folder is always the server's, never the page's word, and the CLI
runs in the background (the page's other messages aren't held up)."""

import asyncio
from pathlib import Path

from orb import cli, items, server, settings


class Conn:
    folder = key = None

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, ev):
        self.sent.append(ev)


async def settle() -> None:
    """Let the Hub's background tasks (the CLI start) finish."""
    while server.hub.background:
        await asyncio.gather(*server.hub.background)


def rig(monkeypatch, tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    ran: list[tuple] = []

    async def fake_start(repo, brief, title, connectors=None):
        ran.append((repo, brief, title, connectors))
        return {"id": "bg-1", "output": "Started bg-1", "error": None}

    monkeypatch.setattr(cli, "start", fake_start)
    monkeypatch.setattr(server.hub, "allowed_folder", lambda p: Path(p) if p == str(web) else None)
    monkeypatch.setattr(server.hub, "label", lambda p: "acme/web")
    monkeypatch.setattr(items, "get", lambda source, item_id, *a: {"title": "Fix checkout", "brief": "Help me with a task…", "repo_path": str(web)}.copy())
    monkeypatch.setattr(server, "item_args", lambda: ())
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setitem(settings.settings.data, "profile", "work")
    return web, ran


async def test_item_start_goes_to_the_cli_by_default_and_to_orb_when_asked(monkeypatch, tmp_path):
    web, ran = rig(monkeypatch, tmp_path)
    started: list[tuple] = []

    async def fake_task(conn, path, brief):
        started.append((path, brief))

    monkeypatch.setattr(server.hub, "start_task", fake_task)
    conn = Conn()
    await server.handle(conn, {"type": "item_start", "source": "vikunja", "id": "7"})
    await settle()
    assert ran == [(str(web), "Help me with a task…", "Fix checkout", {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"})] and started == []
    assert conn.sent[-1] == {"type": "cli_started", "title": "Fix checkout", "repo": "acme/web", "id": "bg-1", "output": "Started bg-1", "error": None,
                             "command": "claude --bg --name 'Fix checkout' -- 'Help me with a task…'"}
    await server.handle(conn, {"type": "item_start", "source": "vikunja", "id": "7", "where": "browser"})
    assert started == [(str(web), "Help me with a task…")] and len(ran) == 1
    monkeypatch.setitem(settings.settings.data, "start_in", "browser")
    await server.handle(conn, {"type": "item_start", "source": "vikunja", "id": "7"})
    assert len(started) == 2 and len(ran) == 1
    await server.handle(conn, {"type": "item_start", "source": "vikunja", "id": "7", "where": "cli"})
    await settle()
    assert len(started) == 2 and len(ran) == 2
    await server.handle(conn, {"type": "item_start", "source": "vikunja", "id": "7", "where": "terminal"})
    await settle()
    assert conn.sent[-1]["type"] == "error" and len(started) == 2 and len(ran) == 2


async def test_cli_start_takes_only_an_allowed_folder_and_a_brief(monkeypatch, tmp_path):
    web, ran = rig(monkeypatch, tmp_path)
    conn = Conn()
    await server.handle(conn, {"type": "cli_start", "path": str(tmp_path / "elsewhere"), "brief": "x", "title": "t"})
    await server.handle(conn, {"type": "cli_start", "path": str(web), "brief": " \n", "title": "t"})
    await settle()
    assert [e["type"] for e in conn.sent] == ["error", "error"] and ran == []
    await server.handle(conn, {"type": "cli_start", "path": str(web), "brief": "Help me get this task done: Send the invoice", "title": "Send the invoice"})
    assert conn.sent[-1]["type"] == "error"  # not yet: the CLI runs in the background
    await settle()
    assert ran[0][:3] == (str(web), "Help me get this task done: Send the invoice", "Send the invoice")
    assert conn.sent[-1]["type"] == "cli_started" and conn.sent[-1]["id"] == "bg-1"


def test_start_in_setting_takes_only_its_two_values(monkeypatch):
    monkeypatch.setitem(settings.settings.data, "start_in", "cli")
    settings.settings.update({"start_in": "terminal"})
    assert settings.settings["start_in"] == "cli"
    settings.settings.update({"start_in": "browser"})
    assert settings.settings["start_in"] == "browser"
