"""home.summary: open tasks and recent notes from the vault, read-only, skipping hidden and never-open folders."""

import os

from orb import home, protocol


def write(path, text, mtime):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.utime(path, (mtime, mtime))


def test_tasks_and_notes(tmp_path):
    now = 1_800_000_000
    write(tmp_path / "inbox" / "today.md", "# Today\n- [ ] Send the invoice\n- [x] Done already\n  * [ ] Nested task\n", now - 60)
    write(tmp_path / "ops" / "old.md", "- [ ] Old task\nplain line\n", now - 30 * 86400)
    write(tmp_path / ".obsidian" / "hidden.md", "- [ ] never read\n", now)
    write(tmp_path / "secrets" / "keys.md", "- [ ] never read either\n", now)
    write(tmp_path / "notes.txt", "- [ ] not markdown\n", now)

    s = home.summary(tmp_path, now=now)

    assert [t["text"] for t in s["tasks"]] == ["Send the invoice", "Nested task", "Old task"]
    assert s["tasks"][0] | {"mtime": 0} == {"text": "Send the invoice", "file": "inbox/today.md", "line": 2, "mtime": 0}
    assert s["open_tasks"] == 3
    assert [n["title"] for n in s["notes"]] == ["Today", "old"]
    assert s["notes_week"] == 1
    protocol.SERVER_EVENTS["home"].model_validate(s)


def test_task_limit_keeps_the_total(tmp_path):
    write(tmp_path / "a.md", "\n".join(f"- [ ] task {i}" for i in range(30)), 1)
    s = home.summary(tmp_path, tasks=5)
    assert len(s["tasks"]) == 5 and s["open_tasks"] == 30


def test_no_vault():
    s = home.summary(None)
    assert s == {"type": "home", "vault": "", "tasks": [], "open_tasks": 0, "notes": [], "notes_week": 0}
    protocol.SERVER_EVENTS["home"].model_validate(s)
