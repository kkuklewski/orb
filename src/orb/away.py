"""The Away recap's clock (GLOSSARY: Away recap): when the owner last acted on a page, and the one-shot card on Home
after they were away 24 hours or more.

Acting is a click or a message (ACTIONS); a page that is only open, polling Home or reconnecting, is not. The time
lives in Orb's own state (`~/.orb/away.json`), never in the vault. While the owner is away the recap is live (its span
grows); their first action back freezes it (`since` .. `back`) until a page says it was seen (`away_seen`: closed, or
Home left), and a frozen recap nobody saw goes after RECAP_KEEP. The card never gets a Badge."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

from . import config

AWAY_SECONDS = 24 * 3600
RECAP_KEEP = 12 * 3600  # a recap the owner came back to but never closed is gone this long after
SAVE_EVERY = 60  # last-active is written at most this often, a recap change at once
LINES = 8  # the card's lines (routines, later Finished and Ready); past this one "N more"

# Page messages that are the owner acting. Everything else (home, routines, screen, the lists and reads, open_folder on a
# reload, settings reads, speech plumbing) can come from a page nobody is looking at.
ACTIONS = frozenset({
    "user_text", "voice_text", "utterance", "interrupt", "permission", "dictate_note", "undo_request", "undo_confirm",
    "new_session", "start_session", "add_folder", "pin_folder", "archive_session", "remove_session", "set_settings",
    "plan_start", "plan_later", "plan_done", "item_start", "item_done", "task_action", "tasks_bulk", "notes_verdict",
    "brain_apply", "brain_verdict", "routines_resolve", "make_task", "make_task_confirm", "make_task_undo", "drop",
    "delegate", "delegate_bulk", "delegate_confirm", "delegation_review", "delegation_apply", "delegation_revert",
    "delegation_discard", "delegation_retry", "delegation_resume", "delegation_outward", "revoke_grant", "away_seen",
})


def heading(seconds: float) -> str:
    """'While you were away · 2 days' from 48 hours on, hours below."""
    hours = int(seconds // 3600)
    span = f"{hours // 24} days" if hours >= 48 else f"{hours} hours"
    return f"While you were away · {span}"


class Clock:
    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            data = {}
        self.last_active: float | None = data.get("last_active")
        self.recap: dict | None = data.get("recap")  # {"since", "back"}: the owner is back, the card not seen yet
        self.saved: float | None = self.last_active  # None: nothing written yet, the first action is

    def save(self) -> None:
        config.write_private(self.path, json.dumps({"last_active": self.last_active, "recap": self.recap}))
        self.saved = self.last_active

    def acted(self, now: float | None = None) -> bool:
        """The owner did something on a page. True when the recap changed (a page should hear about it)."""
        now = time.time() if now is None else now
        changed = False
        if self.recap is None and self.last_active is not None and now - self.last_active >= AWAY_SECONDS:
            self.recap, changed = {"since": self.last_active, "back": now}, True
        self.last_active = now
        if changed or self.saved is None or now - self.saved >= SAVE_EVERY:
            self.save()
        return changed

    def seen(self) -> bool:
        """A page showed the card and the owner closed it or left Home: it is gone everywhere."""
        if self.recap is None:
            return False
        self.recap = None
        self.save()
        return True

    def current(self, now: float | None = None, lines: Callable[[float], list[dict]] | None = None) -> dict | None:
        """The recap a page shows now: frozen once the owner is back, live while they are still away, else None.
        `lines(since)` gives what finished without the owner; the card keeps the first LINES and counts the rest."""
        now = time.time() if now is None else now
        if self.recap and now - self.recap["back"] >= RECAP_KEEP:
            self.recap = None
            self.save()
        if self.recap:
            since, back = self.recap["since"], self.recap["back"]
        elif self.last_active is not None and now - self.last_active >= AWAY_SECONDS:
            since, back = self.last_active, None
        else:
            return None
        got = [{k: v for k, v in x.items() if k != "at"} for x in (lines(since) if lines else [])]
        return {"since": since, "back": back, "heading": heading((back or now) - since), "lines": got[:LINES],
                "more": max(0, len(got) - LINES)}

    def event(self, now: float | None = None, lines: Callable[[float], list[dict]] | None = None) -> dict:
        return {"type": "away_recap", "recap": self.current(now, lines)}
