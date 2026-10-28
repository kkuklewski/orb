"""vault_write: the only writer of Orb's code to the notes vault (ADR 0007). Each allowed write, each refusal, an
off-allowlist attempt, and no git."""

import asyncio
import datetime as dt
import os
import inspect
import subprocess

import pytest

from orb import home, items, server, settings, tasks, vault_git, vault_write
from orb.vault_write import TaskError

DAY = dt.date(2026, 10, 24)


def note(root, name, extra="", published="2026-06-14T00:00:00.000Z"):
    p = root / "scrapers" / "Inbox" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\ntitle: {name}\npublished: {published}\ncluster: security\nfact_checked_at: 2026-06-17\n{extra}---\n\n# {name}\n\nBody\n")
    return str(p.relative_to(root))


@pytest.fixture(autouse=True)
def no_git(monkeypatch):
    """Orb commits nothing: any process started during a write fails the test, except the read-only clone check
    (vault_git: git with --no-optional-locks running one of its READS)."""
    real = subprocess.Popen

    def refuse(*a, **kw):
        raise AssertionError(f"a process was started: {a}")

    def read_only(args, *a, **kw):  # subprocess.run starts its process through Popen
        if args[:2] == ["git", "--no-optional-locks"] and args[8] in vault_git.READS:
            return real(args, *a, **kw)
        refuse(args)
    for name in ("call", "check_call", "check_output"):
        monkeypatch.setattr(subprocess, name, refuse)
    monkeypatch.setattr(subprocess, "Popen", read_only)
    monkeypatch.setattr(os, "system", refuse)


def test_reject_writes_two_fields_and_keeps_the_rest(tmp_path):
    f = note(tmp_path, "a.md")
    assert vault_write.set_verdict(tmp_path, {f: ""}, "reject", DAY) == 1
    text = (tmp_path / f).read_text()
    assert "human_verdict: reject\nverdict_at: '2026-10-24'\n---\n\n# a.md\n\nBody\n" in text
    assert "cluster: security" in text
    assert not list((tmp_path / "scrapers" / "Inbox").glob(".orb-*"))  # no temp file left behind


def test_a_new_verdict_replaces_the_old_and_restore_removes_the_fields(tmp_path):
    f = note(tmp_path, "a.md", "human_verdict: reject\nverdict_at: 2026-06-20\nowner_read: '2026-06-19'\n")
    vault_write.set_verdict(tmp_path, {f: "reject 2026-06-20"}, "approve", DAY)
    text = (tmp_path / f).read_text()
    assert text.count("human_verdict") == 1 and "human_verdict: approve" in text and "2026-06-20" not in text
    vault_write.set_verdict(tmp_path, {f: "approve 2026-10-24"}, "restore", DAY)
    text = (tmp_path / f).read_text()
    assert not any(k in text for k in ("human_verdict", "verdict_at", "owner_read")) and "cluster: security" in text


def test_a_verdict_on_a_note_that_changed_writes_nothing(tmp_path):
    a, b = note(tmp_path, "a.md"), note(tmp_path, "b.md", "human_verdict: approve\nverdict_at: '2026-10-23'\n")
    before = (tmp_path / a).read_text(), (tmp_path / b).read_text()
    with pytest.raises(TaskError, match="The note changed since Orb read it.*b.md"):
        vault_write.set_verdict(tmp_path, {a: "", b: ""}, "reject", DAY)  # the page saw b pending; it was judged since
    assert ((tmp_path / a).read_text(), (tmp_path / b).read_text()) == before


def test_nothing_is_written_when_one_path_is_refused(tmp_path):
    f = note(tmp_path, "a.md")
    (tmp_path / "plain.md").write_text("no frontmatter\n")
    for bad in ({"../x.md": ""}, {f: "", "plain.md": ""}, {f: "", "missing.md": ""}):
        with pytest.raises(TaskError):
            vault_write.set_verdict(tmp_path, bad, "reject", DAY)
    assert "human_verdict" not in (tmp_path / f).read_text()
    for verdict in ("defer", "delete"):
        with pytest.raises(TaskError, match="Unknown verdict"):
            vault_write.set_verdict(tmp_path, {f: ""}, verdict, DAY)
    with pytest.raises(TaskError):
        vault_write.set_verdict(tmp_path, {}, "reject", DAY)
    assert "human_verdict" not in (tmp_path / f).read_text()


def test_owner_read_is_set_once(tmp_path):
    f = note(tmp_path, "a.md")
    vault_write.set_owner_read(tmp_path, f, "", DAY)
    text = (tmp_path / f).read_text()
    assert "owner_read: '2026-10-24'\n---" in text and text.count("owner_read") == 1
    with pytest.raises(TaskError, match="changed"):
        vault_write.set_owner_read(tmp_path, f, "", DAY)  # already read: the page's view is stale
    assert (tmp_path / f).read_text() == text


def test_a_task_line_changes_only_its_marker_and_date(tmp_path):
    (tmp_path / "t.md").write_text("# T\n\n- [ ] Call acme ⏳ 2026-10-20\n")
    vault_write.set_task_line(tmp_path, "t.md", 3, "- [ ] Call acme ⏳ 2026-10-20", "- [x] Call acme ✅ 2026-10-24")
    assert (tmp_path / "t.md").read_text() == "# T\n\n- [x] Call acme ✅ 2026-10-24\n"
    vault_write.set_task_line(tmp_path, "t.md", 3, "- [x] Call acme ✅ 2026-10-24", "- [ ] Call acme")  # Undo
    assert (tmp_path / "t.md").read_text() == "# T\n\n- [ ] Call acme\n"


@pytest.mark.parametrize("new, why", [
    ("- [ ] Call globex", "marker and date"),  # different text
    ("  - [ ] Call acme", "marker and date"),  # moved
    ("- [?] Call acme", "marker and date"),  # not a marker Orb writes
    ("# Call acme", "only writes task lines"),
    ("- [ ] Call acme\n- [ ] More", "only writes task lines"),
])
def test_off_the_allowlist_is_refused(tmp_path, new, why):
    (tmp_path / "t.md").write_text("- [ ] Call acme\n")
    with pytest.raises(TaskError, match=why):
        vault_write.set_task_line(tmp_path, "t.md", 1, "- [ ] Call acme", new)
    assert (tmp_path / "t.md").read_text() == "- [ ] Call acme\n"


def test_a_task_line_that_changed_is_refused(tmp_path):
    (tmp_path / "t.md").write_text("- [ ] Call acme today\n")
    with pytest.raises(TaskError, match="The note changed since Orb read it"):
        vault_write.set_task_line(tmp_path, "t.md", 1, "- [ ] Call acme", "- [x] Call acme ✅ 2026-10-24")
    assert (tmp_path / "t.md").read_text() == "- [ ] Call acme today\n"


def test_line_endings_survive_every_write(tmp_path):
    p = tmp_path / "w.md"
    p.write_bytes(b"---\r\ntitle: w\r\n---\r\n- [ ] one\r\n")
    vault_write.set_verdict(tmp_path, {"w.md": ""}, "approve", DAY)
    vault_write.set_owner_read(tmp_path, "w.md", "", DAY)
    vault_write.set_task_line(tmp_path, "w.md", 7, "- [ ] one", "- [-] one ❌ 2026-10-24")
    assert p.read_bytes() == b"---\r\ntitle: w\r\nhuman_verdict: approve\r\nverdict_at: '2026-10-24'\r\nowner_read: '2026-10-24'\r\n---\r\n- [-] one \xe2\x9d\x8c 2026-10-24\r\n"


def test_no_other_module_writes_to_the_vault():
    """The only vault writer is vault_write: the other modules that touch notes neither write files nor replace them."""
    for mod in (tasks, home, items):
        src = inspect.getsource(mod)
        assert not any(w in src for w in ("os.replace", "write_text", "write_bytes", "mkstemp", '"wb"', '"w"')), mod.__name__


def test_the_notes_list_shows_pending_and_recently_judged_with_published_and_topic(tmp_path):
    pending = note(tmp_path, "p.md")
    judged = note(tmp_path, "j.md", f"human_verdict: reject\nverdict_at: '{dt.date.today().isoformat()}'\n")
    old = note(tmp_path, "o.md", "human_verdict: reject\nverdict_at: 2026-06-20\n")
    got = items.list_("notes", {}, tmp_path, [])
    rows = {r["id"]: r for r in got["rows"]}
    assert set(rows) == {pending, judged} and old not in rows  # the June verdict is out of the 14 days
    assert rows[pending]["cells"]["published"] == "2026-06-14" and rows[pending]["cells"]["topic"] == "security"
    assert rows[pending]["cells"]["verdict"] == "" and rows[judged]["cells"]["verdict"] == f"reject {dt.date.today().isoformat()}"
    assert got["can_judge"] and got["group_key"] == "topic"
    vault_write.set_verdict(tmp_path, {judged: rows[judged]["cells"]["verdict"]}, "restore", DAY)  # the cell is what the page sends back


def test_judged_notes_window(tmp_path):
    note(tmp_path, "new.md", "human_verdict: defer\nverdict_at: '2026-10-20'\n")  # an old defer still lists, to be restored
    note(tmp_path, "edge.md", "human_verdict: approve\nverdict_at: 2026-10-10\n")
    note(tmp_path, "old.md", "human_verdict: reject\nverdict_at: 2026-10-09\n")
    got = home.judged_notes(tmp_path, 14, DAY)
    assert [(n["title"], n["verdict"]) for n in got] == [("new.md", "defer"), ("edge.md", "approve")]


class Page:
    def __init__(self):
        self.got = []

    async def send(self, ev):
        self.got.append(ev)


@pytest.mark.parametrize("seen, verdict, refusal", [
    ("", "reject", "The note changed since Orb read it"),  # judged since the page read it
    ("approve 2026-10-23", "defer", "Unknown verdict"),  # defer is gone
])
def test_the_server_refuses_and_tells_the_page(tmp_path, monkeypatch, seen, verdict, refusal):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path))
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    f = note(tmp_path, "a.md", "human_verdict: approve\nverdict_at: '2026-10-23'\n")
    before = (tmp_path / f).read_text()
    page = Page()
    asyncio.run(server.handle(page, {"type": "notes_verdict", "notes": [{"file": f, "seen": seen}], "verdict": verdict}))
    assert [e["type"] for e in page.got] == ["error"] and refusal in page.got[0]["text"]
    assert (tmp_path / f).read_text() == before


def test_the_server_writes_a_verdict_and_sends_the_new_list(tmp_path, monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path))
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    f = note(tmp_path, "a.md")
    page = Page()
    asyncio.run(server.handle(page, {"type": "notes_verdict", "notes": [{"file": f, "seen": ""}], "verdict": "approve"}))
    assert [e["type"] for e in page.got] == ["item_list"] and "human_verdict: approve" in (tmp_path / f).read_text()
