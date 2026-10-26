"""Brain: the notes list, a note's page, the Verdict control (approve, reject, restore) and owner_read, which is set
only when the owner leaves an open note, never on open and never twice. Writes go through vault_write (ADR 0007)."""

import asyncio
import os

import pytest
from pydantic import TypeAdapter

from orb import protocol, server, settings

EVENTS = TypeAdapter(protocol.ServerEvent)
MESSAGES = TypeAdapter(protocol.ClientMessage)


def note(root, name, extra="", body="Body", folder="scrapers/Inbox", mtime=None):
    p = root / folder / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\ntitle: {name}\n{extra}---\n\n# {name.removesuffix('.md').title()}\n\n{body}\n")
    if mtime:
        os.utime(p, (mtime, mtime))
    return str(p.relative_to(root))


class Page:
    def __init__(self):
        self.got = []

    async def send(self, ev):
        EVENTS.validate_python(ev)
        self.got.append(ev)


@pytest.fixture
def vault(tmp_path, monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", str(tmp_path))
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    return tmp_path


def ask(msg):
    MESSAGES.validate_python(msg)
    page = Page()
    asyncio.run(server.handle(page, msg))
    return page.got


def test_the_list_is_newest_notes_with_kind_score_and_waiting_and_leaves_out_the_rest(vault):
    a = note(vault, "alpha.md", "value_score: 8\nvalue_lane: news\nvalue_why: new release\n", mtime=3000)
    b = note(vault, "beta.md", "written_by: owner\n", folder="inbox", mtime=2000)
    c = note(vault, "gamma.md", "curated_by: ai\nhuman_reviewed: false\n", folder="scrapers/Topics", mtime=1000)
    note(vault, "stub.md", "kind: review\n")  # bookkeeping
    note(vault, "vetoed.md", "status: vetoed\n")
    (vault / "plain.md").write_text("# No frontmatter\n")
    (vault / "data.json").write_text("{}")
    note(vault, "s.md", folder=".claude/sessions")  # hidden folder: never entered
    got = ask({"type": "brain_list"})
    assert [e["type"] for e in got] == ["brain_list"]
    rows = got[0]["notes"]
    assert [r["file"] for r in rows] == [a, b, c]
    assert rows[0] | {"mtime": 0} == {"file": a, "title": "Alpha", "kind": "capture", "mtime": 0, "score": 8, "lane": "news",
                                      "why": "new release", "waiting": True, "verdict": "", "owner_read": "", "suggest": "approve"}
    assert (rows[1]["kind"], rows[1]["waiting"], rows[1]["score"]) == ("your note", False, None)
    assert (rows[2]["kind"], rows[2]["waiting"]) == ("AI", True)


def test_without_a_notes_folder_the_list_says_so(monkeypatch):
    monkeypatch.setitem(settings.settings.data, "vault", "")
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    assert ask({"type": "brain_list"}) == [{"type": "brain_list", "notes": [], "error": "No notes folder is set up."}]


def test_a_note_page_has_the_fields_and_the_body_without_frontmatter(vault):
    f = note(vault, "alpha.md", "value_score: 6\nvalue_lane: learning\n", body="Line one\n\nLine two")
    got = ask({"type": "brain_get", "file": f})
    assert [e["type"] for e in got] == ["brain_note"]
    n = got[0]
    assert (n["title"], n["score"], n["lane"], n["waiting"]) == ("Alpha", 6, "learning", True)
    assert n["body"] == "# Alpha\n\nLine one\n\nLine two" and "value_score" not in n["body"]


@pytest.mark.parametrize("file", ["../outside.md", "scrapers/Inbox/missing.md", ".claude/x.md", "data.json"])
def test_a_note_outside_the_vault_is_refused(vault, file):
    (vault.parent / "outside.md").write_text("---\nx: 1\n---\n")
    (vault / "data.json").write_text("{}")
    note(vault, "x.md", folder=".claude")
    got = ask({"type": "brain_get", "file": file})
    assert [e["type"] for e in got] == ["error"]


def test_approve_and_reject_write_only_the_verdict_fields(vault):
    f = note(vault, "alpha.md", "value_score: 8\ncluster: security\n")
    before = (vault / f).read_text()
    got = ask({"type": "brain_verdict", "file": f, "verdict": "reject", "seen": ""})
    assert [e["type"] for e in got] == ["brain_note", "brain_list"]
    after = (vault / f).read_text()
    added = [l for l in after.splitlines() if l not in before.splitlines()]
    assert [l.split(":")[0] for l in added] == ["human_verdict", "verdict_at"] and "human_verdict: reject" in after
    assert set(before.splitlines()) <= set(after.splitlines())  # nothing else changed
    seen = got[0]["verdict"]
    assert seen.startswith("reject ") and not got[0]["waiting"]
    # The written note round-trips through the compare step: the page sends back what it was shown.
    got = ask({"type": "brain_verdict", "file": f, "verdict": "approve", "seen": seen})
    assert got[0]["verdict"].startswith("approve ") and (vault / f).read_text().count("human_verdict") == 1


def test_restore_puts_the_note_back_as_it_was(vault):
    f = note(vault, "alpha.md", "value_score: 8\n")
    before = (vault / f).read_text()
    listed = ask({"type": "brain_list"})[0]["notes"][0]
    seen = ask({"type": "brain_verdict", "file": f, "verdict": "reject", "seen": ""})[0]["verdict"]
    got = ask({"type": "brain_verdict", "file": f, "verdict": "restore", "seen": seen})
    assert got[0]["verdict"] == "" and got[0]["waiting"]
    assert (vault / f).read_text() == before
    assert got[1]["notes"][0] | {"mtime": 0} == listed | {"mtime": 0}


def test_a_verdict_on_a_note_that_changed_is_refused_and_writes_nothing(vault):
    f = note(vault, "alpha.md", "human_verdict: approve\nverdict_at: '2026-10-23'\n")
    before = (vault / f).read_text()
    got = ask({"type": "brain_verdict", "file": f, "verdict": "reject", "seen": ""})
    assert [e["type"] for e in got] == ["error"] and "changed since Orb read it" in got[0]["text"]
    assert (vault / f).read_text() == before


def test_owner_read_is_set_on_leaving_never_on_open_never_twice_never_after_a_verdict(vault):
    f = note(vault, "alpha.md", "value_score: 8\n")
    ask({"type": "brain_get", "file": f})
    assert "owner_read" not in (vault / f).read_text()  # opening writes nothing
    got = ask({"type": "brain_read", "file": f, "seen": ""})
    assert [e["type"] for e in got] == ["brain_list"]
    text = (vault / f).read_text()
    assert text.count("owner_read: '") == 1
    day = got[0]["notes"][0]["owner_read"]
    assert day
    ask({"type": "brain_read", "file": f, "seen": ""})  # a second leave
    ask({"type": "brain_read", "file": f, "seen": day})  # even one that sends the day back
    assert (vault / f).read_text() == text

    g = note(vault, "beta.md", "human_verdict: reject\nverdict_at: '2026-10-23'\n")
    before = (vault / g).read_text()
    ask({"type": "brain_read", "file": g, "seen": ""})
    assert (vault / g).read_text() == before


def test_notes_carry_a_suggestion_from_the_vault_rubric_and_only_while_they_wait(vault):
    (vault / "skills").mkdir()
    (vault / "skills/value.md").write_text("# Value\n\nThresholds: **≥ 7** read today · **4–6** worth a look · **≤ 3** skip.\n")
    files = [note(vault, f"n{s}.md", f"value_score: {s}\n", mtime=1000 + s) for s in (9, 7, 6, 4, 3)]
    done = note(vault, "judged.md", "value_score: 9\nhuman_verdict: approve\nverdict_at: '2026-10-23'\n", mtime=900)
    rows = {r["file"]: r for r in ask({"type": "brain_list"})[0]["notes"]}
    assert [rows[f]["suggest"] for f in files] == ["approve", "approve", "", "", "reject"]
    assert rows[done]["suggest"] == ""  # judged: nothing to suggest


def test_apply_writes_each_verdict_on_its_own_and_keeps_a_refused_note_with_its_reason(vault):
    a = note(vault, "alpha.md", "value_score: 9\n")
    b = note(vault, "beta.md", "value_score: 2\n")
    c = note(vault, "gamma.md", "value_score: 8\nhuman_verdict: reject\nverdict_at: '2026-10-23'\n")  # changed since read
    before = (vault / c).read_text()
    got = ask({"type": "brain_apply", "notes": [{"file": a, "seen": "", "verdict": "approve"}, {"file": c, "seen": "", "verdict": "approve"},
                                                {"file": b, "seen": "", "verdict": "reject"}]})
    assert [e["type"] for e in got] == ["brain_applied", "brain_list"]
    assert got[0]["applied"] == [{"file": a, "verdict": "approve"}, {"file": b, "verdict": "reject"}]
    assert [r["file"] for r in got[0]["refused"]] == [c] and "changed since Orb read it" in got[0]["refused"][0]["reason"]
    assert (vault / c).read_text() == before
    rows = {r["file"]: r for r in got[1]["notes"]}
    assert rows[a]["verdict"].startswith("approve ") and rows[b]["verdict"].startswith("reject ")
    # Restore undoes one verdict that was applied in bulk; the other stays.
    got = ask({"type": "brain_apply", "notes": [{"file": b, "seen": rows[b]["verdict"], "verdict": "restore"}]})
    assert got[0]["applied"] == [{"file": b, "verdict": "restore"}] and not got[0]["refused"]
    rows = {r["file"]: r for r in got[1]["notes"]}
    assert rows[b]["verdict"] == "" and rows[b]["waiting"] and rows[b]["suggest"] == "reject"
    assert rows[a]["verdict"].startswith("approve ")
    assert "human_verdict" not in (vault / b).read_text()


def test_apply_with_no_notes_is_an_error(vault):
    got = ask({"type": "brain_apply", "notes": []})
    assert [e["type"] for e in got] == ["error"]
