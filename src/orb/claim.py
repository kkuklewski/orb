"""The tracker side of Delegate (#866, ADR 0004): the task's assignee is the claim. Allow claims the task before the
worktree: read it, assign the owner when it is free (or already theirs), read it again; a task held by a teammate (any
other assignee) is refused, and Orb never removes someone else's assignment. Discard takes back only an assignment
this delegation added; Apply, Undo and done leave it. Nothing retries a claim by itself.

Neither tracker has a compare-and-set for assignees, so a claim is best effort: the re-read catches a teammate who
got in first, but on Jira (one assignee, a PUT overwrites) a write landing between our read and our PUT is lost to
it. The per-person branch names (worktree.branch_name) keep the two sides apart in git when that happens.
"""

from __future__ import annotations

from collections.abc import Callable

from . import tracker


class ClaimError(Exception):
    """A claim refused or failed; the message says why, in the owner's words."""


def holder(task: dict, me: dict) -> str | None:
    """The teammate holding `task`, or None when it is free or only the owner's (tracker.held_by, the one rule)."""
    return tracker.held_by(task, me)


class Claims:
    """`cfg()` is the live settings dict; every call reads the tracker it names. All calls block (run them in a thread)."""

    def __init__(self, cfg: Callable[[], dict]) -> None:
        self.cfg = cfg

    def me(self) -> dict:
        try:
            return tracker.me(self.cfg())
        except tracker.ERRORS as e:
            raise ClaimError(f"Orb can't tell who you are in {tracker.name(self.cfg())}: {e}") from e

    def check(self, task: dict) -> dict:
        """Before the card: the owner as the tracker knows them; refused when a teammate holds the task."""
        me = self.me()
        if who := holder(task, me):
            raise ClaimError(f"Task #{task['id']} is held by {who}.")
        return me

    def claim(self, task_id: int) -> bool:
        """Claim the task for the owner; True when this call added the assignment (Discard takes back only that)."""
        me, cfg = self.me(), self.cfg()
        try:
            t = tracker.task(cfg, task_id)
            if who := holder(t, me):
                raise ClaimError(f"Task #{task_id} is held by {who}.")
            if any(a["id"] == me["id"] for a in t["assignees"]):
                return False
            tracker.assign(cfg, task_id, me["id"])
            t = tracker.task(cfg, task_id)
        except tracker.ERRORS as e:
            raise ClaimError(f"Couldn't claim task #{task_id}: {e}") from e
        ids = {a["id"] for a in t["assignees"]}
        if me["id"] in ids and not ids - {me["id"]}:
            return True
        if me["id"] in ids:  # someone else got in at the same time: take back ours, leave theirs
            self.release(task_id)
        raise ClaimError(f"Couldn't claim task #{task_id}: "
                         + (f"it is held by {holder(t, me)}." if ids - {me['id']} else f"{tracker.name(cfg)} didn't keep the assignment."))

    def note(self, task_id: int, text: str) -> None:
        """A comment on the task for the teammates (#866 Q6); the owner is its author."""
        try:
            tracker.comment(self.cfg(), task_id, text)
        except tracker.ERRORS as e:
            raise ClaimError(f"Couldn't comment on task #{task_id}: {e}") from e

    def release(self, task_id: int) -> None:
        """Take the owner's assignment back (only ever one this server added)."""
        try:
            tracker.unassign(self.cfg(), task_id, self.me()["id"])
        except tracker.ERRORS as e:
            raise ClaimError(f"Couldn't take back the assignment on task #{task_id}: {e}") from e
