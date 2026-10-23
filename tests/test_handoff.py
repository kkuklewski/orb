import pytest

from orb import handoff

ITEMS = [
    {"path": "/w/brain", "label": "acme/brain", "rel": "brain"},
    {"path": "/w/n8n-hosting", "label": "acme/n8n-hosting", "rel": "n8n-hosting"},
    {"path": "/w/web", "label": "acme/web", "rel": "web"},
    {"path": "/w/old/web", "label": "globex/web", "rel": "old/web"},
]


def test_resolve_by_name_label_and_path():
    assert handoff.resolve(ITEMS, "brain")["path"] == "/w/brain"
    assert handoff.resolve(ITEMS, "Acme/N8N-Hosting")["path"] == "/w/n8n-hosting"
    assert handoff.resolve(ITEMS, "/w/old/web")["path"] == "/w/old/web"
    assert handoff.resolve(ITEMS, "n8n")["path"] == "/w/n8n-hosting"  # unique partial


def test_resolve_refuses_unknown_and_ambiguous():
    with pytest.raises(handoff.HandoffError, match="No repo matches"):
        handoff.resolve(ITEMS, "nope")
    with pytest.raises(handoff.HandoffError, match="several"):
        handoff.resolve(ITEMS, "web")
    with pytest.raises(handoff.HandoffError):
        handoff.resolve(ITEMS, "  ")


def test_hub_opens_a_session_in_the_other_repo_and_starts_it(tmp_path, monkeypatch):
    import asyncio

    from orb import server
    from orb.settings import settings
    for name in ("brain", "web"):
        (tmp_path / name / ".git").mkdir(parents=True)
        (tmp_path / name / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
        (tmp_path / name / ".git" / "config").write_text(f'[remote "origin"]\n\turl = https://github.com/acme/{name}\n')
    monkeypatch.setitem(settings.data, "roots", [str(tmp_path)])
    sent, opened = [], []

    async def fake_send(self, text, source="text"):
        sent.append((self.path, text))

    async def fake_open(conn, path, key):
        opened.append((conn.key, path, key))

    class Conn:
        key = "src"

    monkeypatch.setattr(server.FolderSession, "send", fake_send)
    monkeypatch.setattr(server, "open_session", fake_open)
    hub = server.Hub()
    hub.scan()
    hub.conns.add(Conn())
    src = hub.session(str((tmp_path / "brain").resolve()), "src")
    src.key = "src"

    async def run():
        out = await hub.handoff(src, "web", "Fix the thing in README.")
        await asyncio.gather(*hub.handoffs)
        return out

    out = asyncio.run(run())
    assert "acme/web" in out
    assert opened and opened[0][1] == str((tmp_path / "web").resolve()) and opened[0][0] == "src"
    assert sent == [(str((tmp_path / "web").resolve()), "Handed over by Claude from a session in acme/brain; the brief below was written by the model, not typed by the user.\n\nFix the thing in README.")]

    async def same():
        await hub.handoff(src, "brain", "x")

    with pytest.raises(handoff.HandoffError, match="own repo"):
        asyncio.run(same())


def test_the_tool_always_asks():
    out = handoff.ask({"repo": "web"})["hookSpecificOutput"]
    assert out["permissionDecision"] == "ask" and "web" in out["permissionDecisionReason"]
