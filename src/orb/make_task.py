""""Make it a task": a routine's last run becomes a task in the tracker (ADR 0008, 0010), never a line in the notes.

It is a write, so it goes card first: `card` works out the title and the project (the routine's repo's mapped
project, else the inbox project, settings "tasks_inbox") and the page shows them; only `confirm` with ok creates the task. Orb remembers the
ids it created, and `undo` deletes only one of those, so Undo can never remove a task the owner made.

During a failure streak the task is the routine's Repair task (GLOSSARY: Repair task): one per routine. Allow records it
in the routine's state (`Watch.set_repair`, by the server); while it is open the routine offers no second card.

A No-topic capture (ticket 820) can be the source too: the title is the capture's title (cut to TITLE_MAX), the body
only "From a voice capture, <day>", never its text. Allow also marks the capture read (`owner_read`, so it leaves the
No topic view); Undo deletes the task and takes that owner_read off again.
"""

from __future__ import annotations

import datetime as dt
import secrets
from collections.abc import Callable
from pathlib import Path

from . import routines, tracker, vault_write

MAX_CARDS = 20  # open cards kept; an older one is forgotten and its Allow says so
TITLE_MAX = 80  # a capture's task title
WRITE_ERRORS = (vault_write.TaskError, OSError, UnicodeDecodeError)


def capture_draft(row: dict) -> tuple[str, str]:
    """(title, description) of a No-topic capture's task: its title, and the day it was captured, nothing else."""
    title = " ".join(str(row.get("title") or "Voice capture").split())
    if len(title) > TITLE_MAX:
        title = title[:TITLE_MAX - 1].rstrip() + "…"
    try:
        d = dt.date.fromisoformat(str(row.get("created") or "")[:10])
        day = f"{d.day} {d:%b %Y}"
    except ValueError:
        day = "an unknown day"
    return title, f"From a voice capture, {day}"


class Maker:
    def __init__(self, cfg: Callable[[], dict], vault: Callable[[], Path | None], inbox: Callable[[], str]) -> None:
        self.cfg, self.vault, self.inbox = cfg, vault, inbox
        self.cards: dict[str, dict] = {}  # card id -> what Allow creates
        self.made: dict[int, str] = {}  # task id -> title, created by this server
        self.repairs: dict[int, str] = {}  # task id -> routine id: a Repair task this server created
        self.captures: dict[int, tuple[str, str]] = {}  # task id -> (capture file, the owner_read day Allow wrote)

    def card(self, x: dict | None) -> dict:
        """The card event for routine `x` (a Routines row), or an error event."""
        if not x or not x.get("last"):
            return {"type": "error", "text": "That routine has no run yet."}
        if x.get("repair"):
            return {"type": "error", "text": f"Task #{x['repair']['task']} is still open for this routine."}
        title, description = routines.task_draft(x)
        try:
            pid, project = tracker.project_for(self.cfg(), self.vault(), x.get("repo") or None, self.inbox())
        except tracker.ERRORS as e:
            return {"type": "error", "text": str(e)}
        cid = secrets.token_hex(8)
        self.cards[cid] = {"project_id": pid, "project": project, "title": title, "description": description,
                           "routine": x["id"], "repair": bool(x.get("streak"))}
        while len(self.cards) > MAX_CARDS:
            self.cards.pop(next(iter(self.cards)))
        return {"type": "make_task_card", "id": cid, "routine": x["id"], "title": title, "project": project}

    def capture_card(self, row: dict | None) -> dict:
        """The card event for a No-topic capture (a home.notopic_notes row, None once it left the list), or an error."""
        if not row:
            return {"type": "error", "text": "That capture has a topic or your decision now."}
        title, description = capture_draft(row)
        try:
            pid, project = tracker.project_for(self.cfg(), self.vault(), None, self.inbox())
        except tracker.ERRORS as e:
            return {"type": "error", "text": str(e)}
        cid = secrets.token_hex(8)
        self.cards[cid] = {"project_id": pid, "project": project, "title": title, "description": description,
                           "routine": "", "repair": False, "capture": row["file"], "seen": row.get("owner_read") or ""}
        while len(self.cards) > MAX_CARDS:
            self.cards.pop(next(iter(self.cards)))
        return {"type": "make_task_card", "id": cid, "capture": row["file"], "title": title, "project": project}

    def confirm(self, cid: str, ok: bool) -> dict:
        c = self.cards.pop(cid, None)
        if c is None:
            return {"type": "make_task_done", "id": cid, "ok": False, "error": "That card has expired. Press Make it a task again."}
        if not ok:
            return {"type": "make_task_done", "id": cid, "ok": False}
        capture, day = c.get("capture"), dt.date.today().isoformat()
        src = {"capture": capture} if capture else {}
        if capture:  # the capture first: a vault that refuses the write (mid-merge, changed) creates no task
            try:
                vault_write.set_owner_read(self.vault(), capture, c["seen"], dt.date.fromisoformat(day))
            except WRITE_ERRORS as e:
                return {"type": "make_task_done", "id": cid, "ok": False, **src, "error": str(e)}
        try:
            t = tracker.create(self.cfg(), c["project_id"], c["title"], c["description"])
        except tracker.ERRORS as e:
            if capture:
                try:
                    vault_write.clear_owner_read(self.vault(), capture, day)
                except WRITE_ERRORS:
                    pass  # it stays read; the owner can still find it in Brain
            return {"type": "make_task_done", "id": cid, "ok": False, **src, "error": str(e)}
        self.made[t["id"]] = t["title"]
        if c["repair"]:
            self.repairs[t["id"]] = c["routine"]
        if capture:
            self.captures[t["id"]] = (capture, day)
        return {"type": "make_task_done", "id": cid, "ok": True, "task": t["id"], "title": t["title"], "url": t["url"],
                "project": c["project"], **src}

    def undo(self, task_id: int) -> dict:
        if task_id not in self.made:
            return {"type": "make_task_undone", "task": task_id, "ok": False,
                    "error": "Orb only removes a task it just created, and not after a restart."}
        try:
            tracker.delete(self.cfg(), task_id)
        except tracker.ERRORS as e:
            return {"type": "make_task_undone", "task": task_id, "ok": False, "error": str(e)}
        del self.made[task_id]
        self.repairs.pop(task_id, None)
        capture, day = self.captures.pop(task_id, (None, ""))
        if capture:
            try:
                vault_write.clear_owner_read(self.vault(), capture, day)
            except WRITE_ERRORS:
                return {"type": "make_task_undone", "task": task_id, "ok": True, "capture": capture,
                        "error": "The task is gone; the capture changed since, so it stays marked read."}
        return {"type": "make_task_undone", "task": task_id, "ok": True, **({"capture": capture} if capture else {})}
