"""tasks: read one task in context; change exactly its line, only when it still reads as expected."""

import datetime as dt

import pytest

from orb import home, protocol, tasks

TODAY = dt.date(2026, 10, 23)
NOTE = "# G7 lunch\n\n## Action Checklist\n\n- [ ] Inventory all agents\n- [ ] Add approval gates (align [[hitl]]).\n- [x] Old one\n"


@pytest.fixture
def vault(tmp_path):
    (tmp_path / "inbox").mkdir()
    (tmp_path / "inbox" / "g7.md").write_text(NOTE)
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "keys.md").write_text("- [ ] rotate\n")
    return tmp_path


def read(vault):
    return (vault / "inbox" / "g7.md").read_text()


def test_detail_shows_the_line_in_context(vault):
    d = tasks.detail(vault, "inbox/g7.md", 6)
    assert d["raw"] == "- [ ] Add approval gates (align [[hitl]])."
    assert (d["title"], d["heading"]) == ("G7 lunch", "Action Checklist")
    assert [c["n"] for c in d["context"]][0] == 1 and d["context"][5]["text"] == d["raw"]
    protocol.SERVER_EVENTS["task_detail"].model_validate(d)


def test_done_then_undo(vault):
    raw = "- [ ] Add approval gates (align [[hitl]])."
    ev = tasks.act(vault, "inbox/g7.md", 6, raw, "done", today=TODAY)
    assert ev["raw"] == "- [x] Add approval gates (align [[hitl]]). ✅ 2026-10-23" and ev["previous"] == raw
    assert read(vault) == NOTE.replace(raw, ev["raw"])
    protocol.SERVER_EVENTS["task_changed"].model_validate(ev)
    tasks.act(vault, "inbox/g7.md", 6, ev["raw"], "restore", value=raw)
    assert read(vault) == NOTE


def test_snooze_hides_it_from_home_until_the_day(vault):
    raw = "- [ ] Inventory all agents"
    ev = tasks.act(vault, "inbox/g7.md", 5, raw, "snooze", until="2026-10-26", today=TODAY)
    assert ev["raw"] == "- [ ] Inventory all agents ⏳ 2026-10-26"
    now = dt.datetime(2026, 10, 23, 12).timestamp()
    s = home.summary(vault, now=now)
    assert [t["text"] for t in s["tasks"]] == ["Add approval gates (align hitl)."] and s["snoozed"] == 1
    later = home.summary(vault, now=dt.datetime(2026, 10, 27, 9).timestamp())
    assert "Inventory all agents" in [t["text"] for t in later["tasks"]]  # back, without the ⏳ in its text
    again = tasks.act(vault, "inbox/g7.md", 5, ev["raw"], "snooze", until="2026-11-02", today=TODAY)
    assert again["raw"] == "- [ ] Inventory all agents ⏳ 2026-11-02"  # one date, not two


def test_drop(vault):
    ev = tasks.act(vault, "inbox/g7.md", 5, "- [ ] Inventory all agents", "drop", today=TODAY)
    assert ev["raw"] == "- [-] Inventory all agents ❌ 2026-10-23"


def test_a_note_that_changed_is_never_overwritten(vault):
    with pytest.raises(tasks.TaskError, match="changed"):
        tasks.act(vault, "inbox/g7.md", 5, "- [ ] Inventory ALL agents", "done", today=TODAY)
    with pytest.raises(tasks.TaskError):
        tasks.act(vault, "inbox/g7.md", 99, "- [ ] Inventory all agents", "done", today=TODAY)
    assert read(vault) == NOTE


@pytest.mark.parametrize("file", ["../outside.md", "/etc/hosts", "secrets/keys.md", "inbox/missing.md", "inbox"])
def test_only_notes_inside_the_vault(vault, file):
    (vault.parent / "outside.md").write_text("- [ ] x\n")
    with pytest.raises(tasks.TaskError):
        tasks.detail(vault, file, 1)


def test_refusals(vault):
    raw = "- [ ] Inventory all agents"
    with pytest.raises(tasks.TaskError, match="after today"):
        tasks.act(vault, "inbox/g7.md", 5, raw, "snooze", until="2026-10-23", today=TODAY)
    with pytest.raises(tasks.TaskError, match="only writes task lines"):
        tasks.act(vault, "inbox/g7.md", 5, raw, "restore", value="rm -rf /")
    with pytest.raises(tasks.TaskError, match="only writes task lines"):
        tasks.act(vault, "inbox/g7.md", 5, raw, "restore", value="- [ ] a\n- [ ] b")
    with pytest.raises(tasks.TaskError, match="No notes folder"):
        tasks.detail(None, "inbox/g7.md", 5)
    assert read(vault) == NOTE


def test_windows_line_endings_survive(tmp_path):
    (tmp_path / "w.md").write_bytes(b"- [ ] one\r\n- [ ] two\r\n")
    tasks.act(tmp_path, "w.md", 2, "- [ ] two", "done", today=TODAY)
    assert (tmp_path / "w.md").read_bytes() == "- [ ] one\r\n- [x] two ✅ 2026-10-23\r\n".encode()


def test_make_it_a_task_appends_one_line_and_undo_removes_it(vault):
    new = '- [ ] Look at the result of "Gmail" (2026-10-23) https://claude.ai/code/s1'
    ev = tasks.add_line(vault, new)
    inbox = vault / "inbox" / "Orb tasks.md"
    assert inbox.read_text() == f"# Orb tasks\n\n{new}\n"
    assert (ev["action"], ev["file"], ev["line"], ev["raw"]) == ("add", "inbox/Orb tasks.md", 3, new)
    protocol.SERVER_EVENTS["task_changed"].model_validate(ev)
    two = new.replace("Gmail", "Etihad")
    assert tasks.add_line(vault, two)["line"] == 4 and inbox.read_text().endswith(f"{new}\n{two}\n")
    with pytest.raises(tasks.TaskError, match="already"):
        tasks.add_line(vault, new)
    gone = tasks.act(vault, "inbox/Orb tasks.md", 3, new, "delete")  # Undo
    assert gone["action"] == "delete" and inbox.read_text() == f"# Orb tasks\n\n{two}\n"
    with pytest.raises(tasks.TaskError, match="changed"):
        tasks.act(vault, "inbox/Orb tasks.md", 3, new, "delete")  # a second Undo finds nothing to remove


def test_only_task_lines_and_only_inside_the_notes(vault, tmp_path):
    with pytest.raises(tasks.TaskError, match="task lines"):
        tasks.add_line(vault, "rm -rf /")
    with pytest.raises(tasks.TaskError, match="task lines"):
        tasks.add_line(vault, "- [ ] a\n- [ ] b")
    with pytest.raises(tasks.TaskError, match="No notes folder"):
        tasks.add_line(None, "- [ ] a")
    (vault / "inbox2").mkdir()
    outside = tmp_path.parent / "elsewhere"
    outside.mkdir(exist_ok=True)
    link_vault = tmp_path / "linked"
    link_vault.mkdir()
    (link_vault / "inbox").symlink_to(outside)
    with pytest.raises(tasks.TaskError, match="link"):
        tasks.add_line(link_vault, "- [ ] a")
    assert not list(outside.iterdir())  # nothing was written through the link
    with pytest.raises(tasks.TaskError):
        tasks.act(vault, "inbox/g7.md", 5, "- [ ] Inventory all agents (", "delete")  # not the line as it reads
