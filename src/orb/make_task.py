""""Make it a task": a routine's last run becomes a task in the tracker (ADR 0008, 0010), never a line in the notes.

It is a write, so it goes card first: `card` works out the title and the project (the routine's repo's mapped
project, else the inbox project, settings "tasks_inbox") and the page shows them; only `confirm` with ok creates the task. Orb remembers the
ids it created, and `undo` deletes only one of those, so Undo can never remove a task the owner made.

During a failure streak the task is the routine's Repair task (GLOSSARY: Repair task): one per routine. Allow records it
in the routine's state (`Watch.set_repair`, by the server); while it is open the routine offers no second card.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from pathlib import Path

from . import routines, tracker

MAX_CARDS = 20  # open cards kept; an older one is forgotten and its Allow says so


class Maker:
    def __init__(self, cfg: Callable[[], dict], vault: Callable[[], Path | None], inbox: Callable[[], str]) -> None:
        self.cfg, self.vault, self.inbox = cfg, vault, inbox
        self.cards: dict[str, dict] = {}  # card id -> what Allow creates
        self.made: dict[int, str] = {}  # task id -> title, created by this server
        self.repairs: dict[int, str] = {}  # task id -> routine id: a Repair task this server created

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

    def confirm(self, cid: str, ok: bool) -> dict:
        c = self.cards.pop(cid, None)
        if c is None:
            return {"type": "make_task_done", "id": cid, "ok": False, "error": "That card has expired. Press Make it a task again."}
        if not ok:
            return {"type": "make_task_done", "id": cid, "ok": False}
        try:
            t = tracker.create(self.cfg(), c["project_id"], c["title"], c["description"])
        except tracker.ERRORS as e:
            return {"type": "make_task_done", "id": cid, "ok": False, "error": str(e)}
        self.made[t["id"]] = t["title"]
        if c["repair"]:
            self.repairs[t["id"]] = c["routine"]
        return {"type": "make_task_done", "id": cid, "ok": True, "task": t["id"], "title": t["title"], "url": t["url"],
                "project": c["project"]}

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
        return {"type": "make_task_undone", "task": task_id, "ok": True}
