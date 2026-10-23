"""What the page shows rides along with the next request, so "summarize this page" works from Home."""

from orb import agent
from orb.agent import FolderSession, request_text
from orb.sessions import SessionStore as Store


def session(monkeypatch, tmp_path):
    events, queries = [], []

    async def emit(ev):
        events.append(ev)

    monkeypatch.setattr(agent.config, "STATE_DIR", tmp_path)
    s = FolderSession("/x", "k1", Store(tmp_path / "sessions.json"), emit, lambda: False)

    class Client:
        async def query(self, q):
            queries.append(q)

    async def ensure_client():
        s.client = Client()

    monkeypatch.setattr(s, "ensure_client", ensure_client)
    return s, events, queries


async def test_the_screen_rides_along_with_typed_and_spoken_requests(monkeypatch, tmp_path):
    s, events, queries = session(monkeypatch, tmp_path)
    s.screen = ("Home", "Good afternoon.\nYour notes hold 31 open tasks.")
    await s.send("gimme a summary from this page", "text")
    assert queries[-1].startswith("[Orb] While asking, the user is looking at Orb's Home screen.")
    assert "<screen>\nGood afternoon.\nYour notes hold 31 open tasks.\n</screen>\n\ngimme a summary from this page" in queries[-1]
    user = [e for e in events if e["type"] == "user"][-1]
    assert user["text"] == "gimme a summary from this page" and user["screen"] == "Home"
    await s.send("what's first", "voice")
    assert "<screen>" in queries[-1] and queries[-1].endswith("what's first")


async def test_nothing_rides_along_from_the_chat_or_with_slash_commands(monkeypatch, tmp_path):
    s, events, queries = session(monkeypatch, tmp_path)
    await s.send("hello", "text")
    assert queries[-1] == "hello"
    s.screen = ("Home", "x")
    await s.send("/review", "text")
    assert queries[-1] == "/review"
    assert [e for e in events if e["type"] == "user"][-1]["screen"] is None


def test_history_shows_only_what_the_user_said():
    q = agent.SCREEN_NOTE.format(name="Task", text="Add approval gates") + "what is this about?"
    assert request_text(q) == "what is this about?"
    lost = agent.LOST_TASKS_NOTE.format(tasks="Run tests") + "\n\n" + q
    assert request_text(lost) == "what is this about?"
    assert request_text("plain [Orb] text") == "plain [Orb] text"
