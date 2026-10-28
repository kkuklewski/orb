"""Brain's Expired view and the Away recap's expired line (docs/adr/0013): pages the vault archived (`auto_archived`),
read from frontmatter only. Keep is the approve verdict; nothing in Orb writes or clears `auto_archived`."""

import asyncio
import datetime as dt
import os
import time

import pytest
from pydantic import TypeAdapter

from orb import away, home, protocol, server, settings

EVENTS = TypeAdapter(protocol.ServerEvent)
MESSAGES = TypeAdapter(protocol.ClientMessage)
H = 3600
TODAY = dt.date(2026, 10, 27)
AI = "curated_by: ai\nhuman_reviewed: false\nvalue_score: 3\nvalue_why: thin rewrite\n"


def note(root, name, extra="", folder="scrapers/Topics", mtime=None):
    p = root / folder / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\ntitle: {name}\n{extra}---\n\n# {name.removesuffix('.md').title()}\n\nBody\n")
    if mtime:
        os.utime(p, (mtime, mtime))
    return str(p.relative_to(root))


class Page:
    def __init__(self):
        self.got = []

    async def send(self, ev):
        EVENTS.validate_python(ev)
        self.got.append(ev)


def ask(msg):
    MESSAGES.validate_python(msg)
    page = Page()
    asyncio.run(server.handle(page, msg))
    return page.got


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path))
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    return tmp_path


def test_the_expired_list_is_the_last_30_days_newest_first(vault):
    a = note(vault, "acme.md", AI + "auto_archived: '2026-10-20'\n", mtime=1000)
    b = note(vault, "globex.md", AI + "auto_archived: 2026-10-26\n", mtime=900)
    c = note(vault, "initech.md", AI + "auto_archived: '2026-09-27'\n")  # exactly 30 days back: in
    note(vault, "umbrella.md", AI + "auto_archived: '2026-09-26'\n")  # 31 days: out
    note(vault, "hooli.md", AI)  # not archived
    note(vault, "stub.md", "kind: review\nauto_archived: '2026-10-25'\n")
    got = home.expired_notes(vault, today=TODAY)
    assert [(n["file"], n["archived"]) for n in got] == [(b, "2026-10-26"), (a, "2026-10-20"), (c, "2026-09-27")]
    assert (got[0]["title"], got[0]["score"], got[0]["why"], got[0]["verdict"]) == ("Globex", 3, "thin rewrite", "")
    assert [n["file"] for n in home.brain_notes(vault)] == ["scrapers/Topics/hooli.md"]  # archived ones stay out of Brain's list


def test_same_day_pages_go_newest_file_first(vault):
    old = note(vault, "acme.md", AI + "auto_archived: '2026-10-26'\n", mtime=1000)
    new = note(vault, "globex.md", AI + "auto_archived: '2026-10-26'\n", mtime=2000)
    assert [n["file"] for n in home.expired_notes(vault, today=TODAY)] == [new, old]


@pytest.mark.parametrize("raw", ["", "'soon'", "'2026-13-40'", "true", "'26-10-2026'"])
def test_a_bad_or_missing_archive_date_is_left_out(vault, raw):
    note(vault, "acme.md", AI + f"auto_archived: {raw}\n")
    assert home.expired_notes(vault, today=TODAY) == []
    assert home.expired_since(vault, 0) == 0


def test_the_page_asks_for_the_expired_view(vault):
    f = note(vault, "acme.md", AI + f"auto_archived: '{dt.date.today().isoformat()}'\n")
    got = ask({"type": "brain_expired"})
    assert [e["type"] for e in got] == ["brain_expired"]
    assert [(n["file"], n["archived"]) for n in got[0]["notes"]] == [(f, dt.date.today().isoformat())]


def test_without_a_notes_folder_the_expired_view_says_so(monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", "")
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    assert ask({"type": "brain_expired"}) == [{"type": "brain_expired", "notes": [], "error": "No notes folder is set up."}]


def test_keep_writes_approve_and_leaves_auto_archived_as_it_was(vault):
    day = dt.date.today().isoformat()
    f = note(vault, "acme.md", AI + f"auto_archived: '{day}'\n")
    archived = [l for l in (vault / f).read_text().splitlines() if l.startswith("auto_archived")]
    got = ask({"type": "brain_apply", "notes": [{"file": f, "seen": "", "verdict": "approve"}]})
    assert got[0] == {"type": "brain_applied", "applied": [{"file": f, "verdict": "approve"}], "refused": []}
    lines = (vault / f).read_text().splitlines()
    assert [l for l in lines if l.startswith("auto_archived")] == archived == [f"auto_archived: '{day}'"]
    assert "human_verdict: approve" in lines
    row = ask({"type": "brain_expired"})[0]["notes"][0]  # still in the view, now kept
    assert row["file"] == f and row["verdict"].startswith("approve ")


def ts(day: str, hour: int) -> float:
    return dt.datetime.fromisoformat(f"{day}T{hour:02d}:00").timestamp()


def test_the_away_count_is_pages_archived_after_the_leave_day(vault):
    note(vault, "acme.md", AI + "auto_archived: '2026-10-24'\n")  # the leave day itself: not counted
    note(vault, "globex.md", AI + "auto_archived: '2026-10-25'\n")  # the next day: counted
    note(vault, "initech.md", AI + "auto_archived: '2026-10-26'\n")
    note(vault, "umbrella.md", AI + "auto_archived: '2026-10-20'\n")
    assert home.expired_since(vault, ts("2026-10-24", 23)) == 2
    assert home.expired_since(vault, ts("2026-10-24", 0)) == 2  # the hour doesn't matter, only the day
    assert home.expired_since(vault, ts("2026-10-26", 9)) == 0


def test_the_expired_line_says_one_or_many_and_nothing_at_0():
    assert away.expired_line(0) == []
    assert away.expired_line(1) == [{"kind": "expired", "id": "expired", "title": "1 page expired", "summary": "", "count": 1}]
    assert away.expired_line(3)[0]["title"] == "3 pages expired"


def test_the_hub_puts_expired_after_the_routines_and_before_finished_and_ready(vault, monkeypatch, tmp_path):
    hub = server.hub
    now = time.time()
    day = dt.date.fromtimestamp(now).isoformat()
    for name in ("acme.md", "globex.md"):
        note(vault, name, AI + f"auto_archived: '{day}'\n")
    monkeypatch.setitem(settings.settings.data, "routines", True)
    monkeypatch.setattr(server.routines, "away_lines", lambda items, runs, logs, since: [
        {"kind": "routine", "id": f"t{i}", "title": f"R{i}", "summary": "", "count": 1, "at": 1.0} for i in range(6)])
    from orb.sessions import SessionStore
    st = SessionStore(tmp_path / "s.json")
    st.set_finished("/r", st.new_session("/r"), now - 10)
    monkeypatch.setattr(hub, "store", st)
    monkeypatch.setattr(hub, "folder_list", lambda: [{"label": "acme", "path": "/r", "sessions": []}])
    monkeypatch.setattr(hub.delegator, "items", {"1": {"session": "x", "stage": "ready", "ready_at": now - 20}})
    since = now - 30 * H
    got = hub.away_lines(since)
    assert [x["kind"] for x in got] == ["routine"] * 6 + ["expired", "finished", "ready"]
    assert got[6]["title"] == "2 pages expired"
    c = away.Clock(tmp_path / "away.json")
    c.last_active = since
    rec = c.current(now=now, lines=hub.away_lines)
    assert [x["kind"] for x in rec["lines"]] == ["routine"] * 6 + ["expired", "finished"] and rec["more"] == 1
    protocol.AwayRecapEvent.model_validate(c.event(now=now, lines=hub.away_lines))


def test_no_expired_page_no_line(vault, monkeypatch):
    note(vault, "acme.md", AI)
    monkeypatch.setitem(settings.settings.data, "routines", False)
    monkeypatch.setattr(server.hub, "folder_list", lambda: [])
    monkeypatch.setattr(server.hub.delegator, "items", {})
    assert server.hub.away_lines(time.time() - 30 * H) == []
