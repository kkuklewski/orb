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
    assert s["tasks"][0] | {"mtime": 0} == {"text": "Send the invoice", "file": "inbox/today.md", "line": 2, "mtime": 0,
                                            "raw": "- [ ] Send the invoice"}
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
    assert s == {"type": "home", "vault": "", "tasks": [], "open_tasks": 0, "snoozed": 0, "notes": [], "notes_week": 0, "awaiting": [], "awaiting_count": 0}
    protocol.SERVER_EVENTS["home"].model_validate(s)


def test_vault_info(tmp_path):
    write(tmp_path / "a.md", "- [ ] one\n- [ ] two\n", 1)
    write(tmp_path / "b.md", "no tasks\n", 1)
    assert home.vault_info(tmp_path) == {"path": str(tmp_path), "exists": True, "notes": 2, "open_tasks": 2}
    assert home.vault_info(tmp_path / "gone")["exists"] is False
    assert home.vault_info(None) is None


def test_tasks_read_as_plain_text(tmp_path):
    write(tmp_path / "a.md", "- [ ] **Call** [[people/Ana|Ana]] about [[Orb]]\n", 1)
    assert home.summary(tmp_path)["tasks"][0]["text"] == "Call Ana about Orb"


def test_awaiting_verdict(tmp_path):
    now = 1_800_000_000
    write(tmp_path / "scrapers" / "Inbox" / "a.md", "---\nfact_checked_at: 2026-10-01\nverification_rate: 0.8\n---\n# Checked\n", now - 10)
    write(tmp_path / "b.md", "---\ncurated_by: ai\nhuman_reviewed: false\n---\n# Topic\n", now - 20)
    write(tmp_path / "c.md", "---\nfact_checked_at: 2026-10-01\nhuman_verdict: approve\n---\n# Done\n", now - 30)
    write(tmp_path / "d.md", "---\nfact_checked_at: 2026-10-01\nstatus: vetoed\n---\n# Vetoed\n", now - 40)
    write(tmp_path / "e.md", "---\nkind: review\nfact_checked_at: x\n---\n", now - 50)
    write(tmp_path / "f.md", "---\ncurated_by: ai\nhuman_reviewed: false\nknowledge_tier: perspective\n---\n# View\n", now - 60)
    s = home.summary(tmp_path, now=now)
    assert [(n["title"], n["tag"], n["verified"]) for n in s["awaiting"]] == [("Checked", "capture", 80), ("Topic", "AI", None), ("View", "unverified view", None)]
    assert s["awaiting_count"] == 3
    protocol.SERVER_EVENTS["home"].model_validate(s)


def test_awaiting_scored_best_first(tmp_path):
    now = 1_800_000_000
    write(tmp_path / "a.md", "---\ncurated_by: ai\nhuman_reviewed: false\nvalue_score: 6\nvalue_why: 'Hooks API for the fence'\nvalue_lane: learning\n---\n# Six\n", now - 10)
    write(tmp_path / "b.md", "---\ncurated_by: ai\nhuman_reviewed: false\n---\n# Unscored\n", now - 5)
    write(tmp_path / "c.md", "---\ncurated_by: ai\nhuman_reviewed: false\nvalue_score: 9\nvalue_lane: news\n---\n# Nine\n", now - 20)
    write(tmp_path / "d.md", "---\ncurated_by: ai\nhuman_reviewed: false\nvalue_score: 3\nauto_archived: 2026-10-25\n---\n# Expired\n", now - 30)
    write(tmp_path / "e.md", "---\ncaptured_via: inspire-routine\nvalue_score: 8\nvalue_lane: bogus\n---\n# Fresh pick\n", now - 40)  # no fact-check yet: still waits
    write(tmp_path / "f.md", "---\nvalue_score: 8\npromoted_to: scrapers/Topics/x\n---\n# Promoted raw\n", now - 50)
    write(tmp_path / "g.md", "---\ncurated_by: ai\nhuman_reviewed: false\nvalue_score: eleven\n---\n# Bad score\n", now - 60)
    s = home.summary(tmp_path, now=now)
    assert [(n["title"], n["score"], n["lane"], n["why"]) for n in s["awaiting"]] == [
        ("Nine", 9, "news", ""), ("Fresh pick", 8, "", ""), ("Six", 6, "learning", "Hooks API for the fence"),
        ("Unscored", None, "", ""), ("Bad score", None, "", "")]
    assert s["awaiting_count"] == 5
    assert home.summary(tmp_path, now=now)["awaiting"] == home.summary(tmp_path, now=now)["awaiting"]
    protocol.SERVER_EVENTS["home"].model_validate(s)
    assert [n["title"] for n in home.awaiting_notes(tmp_path)][:2] == ["Nine", "Fresh pick"]


def test_a_note_linking_out_of_the_vault_is_not_read(tmp_path):
    vault, outside = tmp_path / "notes", tmp_path / "elsewhere"
    write(vault / "inbox" / "a.md", "- [ ] Real task\n", 1_800_000_000)
    write(outside / "b.md", "- [ ] From outside\n", 1_800_000_000)
    (vault / "inbox" / "link.md").symlink_to(outside / "b.md")
    (vault / "inbox" / "same.md").symlink_to(vault / "inbox" / "a.md")  # a link inside the vault is fine
    names = sorted(p.name for p, _ in home._notes(vault))
    assert names == ["a.md", "same.md"]
