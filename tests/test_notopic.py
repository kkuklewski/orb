"""No-topic captures (ticket 820): the rule in home.py, Brain's No topic view with Keep (owner_read) and Drop (the reject
verdict, Restore undoes it), and Up next's "N captures have no topic" item, never Needs you."""

import datetime as dt

from orb import home, needs

from test_brain_page import ask, note, vault  # noqa: F401  (the fixture)

TODAY = dt.date(2026, 10, 28)
OLD = "created: '2026-10-10T08:00:00'\n"


def capture(root, name, kind="thought", extra=OLD, source="voice-capture", folder="inbox/captures"):
    return note(root, name, f"source: {source}\n" + (f"kind: {kind}\n" if kind else "") + extra, folder=folder)


def test_a_capture_no_topic_took_for_a_week_has_no_topic(vault):
    a = capture(vault, "acme-thought.md")
    b = capture(vault, "globex-talk.md", "talk_summary", "created: '2026-10-21'\n")  # 7 days: counts
    c = capture(vault, "acme-voice.md", "", "", source="codex-voice", folder="inbox")  # no `created`: the file's day
    rows = home.notopic_notes(vault, today=dt.date.today() + dt.timedelta(days=8))
    assert [n["file"] for n in rows] == [a, b, c]  # oldest first
    assert rows[0]["created"] == "2026-10-10" and rows[0]["kind"] == "capture"


def test_a_task_capture_counts_at_once_and_a_young_thought_waits(vault):
    t = capture(vault, "acme-task.md", "task", "created: '2026-10-28'\n")
    capture(vault, "young.md", "thought", "created: '2026-10-22'\n")
    assert [n["file"] for n in home.notopic_notes(vault, today=TODAY)] == [t]


def test_promoted_judged_read_dismissed_or_archived_captures_are_left_out(vault):
    for i, extra in enumerate(["promoted_to: '[[Acme]]'\n", "human_verdict: reject\n", "owner_read: '2026-10-20'\n",
                               "rag_dismissed: true\n", "auto_archived: '2026-10-25'\n"]):
        capture(vault, f"out{i}.md", extra=OLD + extra)
    capture(vault, "review.md", "review")  # a kind translate handles
    capture(vault, "link.md", "link")
    capture(vault, "elsewhere.md", folder="scrapers/Inbox")  # not in inbox/
    capture(vault, "codex-kind.md", "thought", source="codex-voice", folder="inbox")  # old voice notes have no kind
    capture(vault, "other.md", source="web-clip")
    assert home.notopic_notes(vault, today=TODAY) == []


def test_the_home_summary_counts_them(vault):
    capture(vault, "acme-task.md", "task", "created: '2026-10-28'\n")
    capture(vault, "acme-thought.md")
    assert home.summary(vault)["notopic_count"] == 2


def test_the_view_lists_them_and_keep_writes_owner_read_once(vault):
    f = capture(vault, "acme-thought.md")
    got = ask({"type": "brain_notopic"})
    assert [n["file"] for n in got[0]["notes"]] == [f]
    got = ask({"type": "brain_keep", "file": f, "seen": ""})
    assert got == [{"type": "brain_applied", "applied": [{"file": f, "verdict": "keep"}], "refused": []}]
    text = (vault / f).read_text()
    assert text.count("owner_read: '") == 1
    assert ask({"type": "brain_notopic"})[0]["notes"] == []  # it left the list
    again = ask({"type": "brain_keep", "file": f, "seen": ""})  # a stale page
    assert again[0]["applied"] == [] and again[0]["refused"][0]["file"] == f
    assert (vault / f).read_text() == text


def test_drop_is_the_reject_verdict_and_the_page_gets_the_row_back_with_its_state(vault):
    f = capture(vault, "acme-thought.md")
    ask({"type": "brain_apply", "notes": [{"file": f, "seen": "", "verdict": "reject"}]})
    assert "human_verdict: reject" in (vault / f).read_text()
    assert ask({"type": "brain_notopic"})[0]["notes"] == []
    row = ask({"type": "brain_notopic", "files": [f, "../outside.md", "missing.md"]})[0]["notes"]
    assert [n["file"] for n in row] == [f] and row[0]["verdict"].startswith("reject ")
    ask({"type": "brain_apply", "notes": [{"file": f, "seen": row[0]["verdict"], "verdict": "restore"}]})  # Restore
    assert [n["file"] for n in ask({"type": "brain_notopic"})[0]["notes"]] == [f]


def test_without_a_notes_folder_the_view_says_so(monkeypatch):
    from orb import settings
    monkeypatch.setitem(settings.settings.data, "vault", "")
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    assert ask({"type": "brain_notopic"}) == [{"type": "brain_notopic", "notes": [], "error": "No notes folder is set up."}]


def test_up_next_gets_one_item_never_needs_you():
    q = needs.queue([], [], [], [], 0, "2026-10-28", notopic=3)
    assert [(c["key"], c["kind"], c["title"], c["group"]) for c in q] == [
        ("notes:notopic", "notopic", "3 captures have no topic", "queue")]
    assert needs.queue([], [], [], [], 0, "2026-10-28", notopic=1)[0]["title"] == "1 capture has no topic"
    assert needs.queue([], [], [], [], 0, "2026-10-28") == []
    assert needs.queue([], [], [], [], 0, "2026-10-28", {"notes:notopic"}, notopic=3) == []  # Later hides it


# -- ticket 835: Make it a task on a capture -------------------------------------------------------------------------

def maker(monkeypatch, vault):
    from orb import make_task, server, vikunja
    from test_make_task import BASE, FakeVikunja
    f = FakeVikunja()
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    monkeypatch.setattr(vikunja, "_get", f.get)
    monkeypatch.setattr(vikunja, "_write", f.write)
    monkeypatch.setattr(server.hub, "maker", make_task.Maker(cfg=lambda: {"vikunja_url": BASE}, vault=lambda: vault,
                                                              inbox=lambda: "Inbox"))
    return f


def test_the_capture_draft_is_its_title_and_day_and_never_its_text():
    from orb import make_task
    long = "Call acme about the " + "very " * 30 + "long idea"
    title, body = make_task.capture_draft({"title": long, "created": "2026-10-10"})
    assert len(title) == 80 and title.endswith("…") and body == "From a voice capture, 10 Oct 2026"
    assert make_task.capture_draft({"title": "Ask globex", "created": ""}) == ("Ask globex", "From a voice capture, an unknown day")


def test_rows_carry_the_captures_own_kind(vault):
    capture(vault, "acme-task.md", "task", "created: '2026-10-28'\n")
    capture(vault, "acme-voice.md", "", OLD, source="codex-voice", folder="inbox")
    assert {n["capture"] for n in home.notopic_notes(vault, today=TODAY)} == {"task", ""}


def test_make_it_a_task_card_allow_marks_it_read_and_undo_takes_both_back(vault, monkeypatch):
    f = maker(monkeypatch, vault)
    c = capture(vault, "acme-task.md", "task", "created: '2026-10-28'\n")
    before = (vault / c).read_text()
    card = ask({"type": "make_task", "capture": c})[0]
    assert card["type"] == "make_task_card" and card["capture"] == c and card["project"] == "Inbox"
    assert card["title"] == "Acme-Task" and f.calls == [] and (vault / c).read_text() == before  # card first
    done = ask({"type": "make_task_confirm", "id": card["id"], "ok": True})[0]
    assert done["ok"] and done["capture"] == c
    (method, path, body), = f.calls
    assert method == "PUT" and path == "/projects/7/tasks"
    assert body["description"].startswith("From a voice capture, ") and "Body" not in body["description"]
    assert "owner_read: '" in (vault / c).read_text()
    assert ask({"type": "brain_notopic"})[0]["notes"] == []  # it left the list
    undone = ask({"type": "make_task_undo", "task": done["task"]})[0]
    assert undone == {"type": "make_task_undone", "task": done["task"], "ok": True, "capture": c}
    assert (vault / c).read_text() == before  # owner_read is off again
    assert [n["file"] for n in ask({"type": "brain_notopic"})[0]["notes"]] == [c]


def test_deny_writes_nothing_and_a_capture_off_the_list_gets_no_card(vault, monkeypatch):
    f = maker(monkeypatch, vault)
    c = capture(vault, "acme-thought.md")
    before = (vault / c).read_text()
    card = ask({"type": "make_task", "capture": c})[0]
    assert ask({"type": "make_task_confirm", "id": card["id"], "ok": False})[0]["ok"] is False
    assert f.calls == [] and (vault / c).read_text() == before
    young = capture(vault, "young.md", "thought", "created: '2099-01-01'\n")
    assert ask({"type": "make_task", "capture": young})[0]["type"] == "error"
    assert ask({"type": "make_task", "capture": "../outside.md"})[0]["type"] == "error"


def test_a_capture_that_changed_after_the_card_creates_no_task(vault, monkeypatch):
    f = maker(monkeypatch, vault)
    c = capture(vault, "acme-thought.md")
    card = ask({"type": "make_task", "capture": c})[0]
    ask({"type": "brain_keep", "file": c, "seen": ""})  # kept from another page meanwhile
    done = ask({"type": "make_task_confirm", "id": card["id"], "ok": True})[0]
    assert done["ok"] is False and done["error"] and f.calls == []


def test_a_failed_create_takes_owner_read_off_again(vault, monkeypatch):
    from orb import vikunja
    maker(monkeypatch, vault)
    c = capture(vault, "acme-thought.md")
    before = (vault / c).read_text()
    card = ask({"type": "make_task", "capture": c})[0]

    def refuse(*a, **k):
        raise vikunja.VikunjaError("Vikunja said no")
    monkeypatch.setattr(vikunja, "_write", refuse)
    done = ask({"type": "make_task_confirm", "id": card["id"], "ok": True})[0]
    assert done["ok"] is False and "no" in done["error"] and (vault / c).read_text() == before
