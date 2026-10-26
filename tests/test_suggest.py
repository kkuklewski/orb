import asyncio

import pytest

from orb import needs, protocol, suggest

TODAY = "2026-10-25"


def test_a_vikunja_task_due_soon_is_take_now_a_mapped_one_delegate_the_rest_later():
    cases = [
        ("2026-10-20", None, "take now"),  # overdue
        ("2026-10-20", "web", "take now"),  # overdue beats a repo
        (TODAY, "web", "take now"),  # due today
        ("2026-11-01", None, "take now"),  # due within a week
        ("2026-11-02", "web", "delegate"),  # past the week: no due pressure
        (None, "web", "delegate"),
        ("2026-11-02", None, "later"),
        (None, None, "later"),
        ("2026-11-02T00:00:00Z", None, "later"),  # Vikunja's long form
        ("not a date", "web", "delegate"),
    ]
    assert [suggest.task(due, repo, TODAY) for due, repo, _ in cases] == [want for *_, want in cases]


def test_a_note_task_reads_its_date_and_is_never_delegated():
    assert suggest.note_task("- [ ] Send the offer 📅 2026-10-24", TODAY) == "take now"
    assert suggest.note_task("- [ ] Send the offer 📅 2026-10-30", TODAY) == "take now"
    assert suggest.note_task("- [ ] Send the offer 📅 2026-12-01", TODAY) == "later"
    assert suggest.note_task("- [ ] Send the offer", TODAY) == "later"
    assert suggest.note_due("- [ ] x 📅2026-10-30 ⏳ 2026-10-26") == "2026-10-30"


TASKS = [
    {"id": 1, "title": "Overdue", "project": "acme", "due": "2026-10-20", "repo": "web"},
    {"id": 2, "title": "Due Friday", "project": "acme", "due": "2026-10-30", "repo": "web"},
    {"id": 3, "title": "Mapped", "project": "acme", "due": None, "repo": "web"},
    {"id": 4, "title": "Unmapped", "project": "globex", "due": None},
]
NOTES = [{"text": "Call the bank 📅 2026-10-26", "file": "a.md", "line": 3, "mtime": 1.0, "raw": "- [ ] Call the bank 📅 2026-10-26"},
         {"text": "Read the book", "file": "a.md", "line": 4, "mtime": 1.0, "raw": "- [ ] Read the book"}]
RESULTS = [{"key": "s1", "label": "fix the login", "repo": "acme", "last_used": 9.0}]
PRS = [{"repo": "acme/web", "number": 12, "title": "Faster search", "updated": 8.0, "idle_days": 3, "draft": False}]
REMINDERS = [{"text": "Renew the domain", "due": "2026-10-24"}]


def test_the_plan_carries_the_suggestion_on_tasks_only_and_never_done_or_drop(tmp_path):
    sent = []

    async def ask(_):
        raise RuntimeError("no model here")

    async def push(ev):
        protocol.PlanEvent.model_validate(ev)
        sent.append(ev)

    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, tasks=TASKS, notes=NOTES, reminders=REMINDERS, now=1.0))
    ev = sent[-1]
    rows = [*ev["needs_you"], ev["next"], *ev["up_next"]]
    said = {r["key"]: r["suggest"] for r in rows}
    assert said == {"reminder:2026-10-24:Renew the domain": None,  # a reminder never gets one
                    "vikunja:1": "take now",  # overdue: in Needs you
                    "vikunja:2": "take now", "vikunja:3": "delegate", "vikunja:4": "later",
                    "note:a.md:3": "take now", "note:a.md:4": "later"}
    others = needs.queue([], [], RESULTS, PRS, 3, TODAY)
    assert [(c["kind"], c["suggest"]) for c in others] == [("result", None), ("pr", None), ("notes_batch", None)]


def test_a_note_is_approve_at_8_or_more_reject_at_4_or_less_and_nothing_between():
    assert [suggest.note(s) for s in (10, 8, 7, 5, 4, 0, None)] == ["approve", "approve", "", "", "reject", "reject", ""]
    assert suggest.note(7, (3, 7)) == "approve" and suggest.note(4, (3, 7)) == ""
    assert "drop" not in {suggest.note(s) for s in range(11)}


@pytest.mark.parametrize("line, want", [
    ("Thresholds: **≥ 8** read today (Home shows it) · **5–7** worth a look · **≤ 4** skip (expires after 14 days unread).", (4, 8)),
    ("Thresholds: **≥ 9** read today · **4–8** worth a look · **≤ 3** skip.", (3, 9)),
    ("**Thresholds:** >= 7 read · <= 2 skip", (2, 7)),
    ("Thresholds: read the good ones, skip the rest.", (4, 8)),  # no numbers: the fallback
    ("Thresholds: **≥ 3** read · **≤ 6** skip", (4, 8)),  # upside down: the fallback
])
def test_thresholds_come_from_the_rubric_line(tmp_path, line, want):
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills/value.md").write_text(f"# Value\n\n| score | ≥ 2 |\n\n{line}\n")
    assert suggest.thresholds(tmp_path) == want


def test_thresholds_fall_back_without_a_rubric(tmp_path):
    assert suggest.thresholds(tmp_path) == (4, 8)
    assert suggest.thresholds(None) == (4, 8)
