"""The Away recap's clock (GLOSSARY: Away recap): when the owner last acted on a page, and the one-shot card on Home
after they were away 24 hours or more.

Acting is a click or a message (ACTIONS); a page that is only open, polling Home or reconnecting, is not. The time
lives in Orb's own state (`~/.orb/away.json`), never in the vault. While the owner is away the recap is live (its span
grows); their first action back freezes it (`since` .. `back`) until a page says it was seen (`away_seen`: closed, or
Home left), and a frozen recap nobody saw goes after RECAP_KEEP. The card never gets a Badge. The Home chat reads the
pending recap, or the last one once it went (`peek`), without touching any of this."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

from . import config

AWAY_SECONDS = 24 * 3600
RECAP_KEEP = 12 * 3600  # a recap the owner came back to but never closed is gone this long after
SAVE_EVERY = 60  # last-active is written at most this often, a recap change at once
LINES = 8  # the card's lines (routines, Expired, then Finished, Ready, archived and waiting for your OK); past this one "N more"

# Page messages that are the owner acting. Everything else (home, routines, screen, the lists and reads, open_folder on a
# reload, settings reads, speech plumbing) can come from a page nobody is looking at.
ACTIONS = frozenset({
    "user_text", "voice_text", "utterance", "interrupt", "permission", "dictate_note", "undo_request", "undo_confirm",
    "new_session", "start_session", "add_folder", "pin_folder", "archive_session", "remove_session", "set_settings",
    "plan_start", "plan_later", "plan_done", "item_start", "cli_start", "item_done", "task_action", "tasks_bulk", "notes_verdict",
    "brain_apply", "brain_verdict", "routines_resolve", "make_task", "make_task_confirm", "make_task_undo", "drop",
    "delegate", "delegate_bulk", "delegate_confirm", "delegation_review", "delegation_apply", "delegation_revert",
    "delegation_discard", "delegation_retry", "delegation_resume", "delegation_outward", "delegation_update", "delegation_reopen", "revoke_grant", "away_seen",
})


def heading(seconds: float) -> str:
    """'While you were away · 2 days' from 48 hours on, hours below."""
    hours = int(seconds // 3600)
    span = f"{hours // 24} days" if hours >= 48 else f"{hours} hours"
    return f"While you were away · {span}"


def expired_line(count: int) -> list[dict]:
    """The pages the vault archived while the owner was away, one line after the routines' (none at 0); it opens
    Brain's Expired view."""
    title = "1 page expired" if count == 1 else f"{count} pages expired"
    return [{"kind": "expired", "id": "expired", "title": title, "summary": "", "count": count}] if count > 0 else []


def waiting_line(count: int) -> list[dict]:
    """Sessions waiting for the owner's OK right now (an open Allow card), one line after Orb's own (none at 0): not an
    action Orb took, a reminder that their work stopped; it opens Sessions, where Orb never answers the card."""
    title = "1 session waits for your OK" if count == 1 else f"{count} sessions wait for your OK"
    return [{"kind": "waiting", "id": "waiting", "title": title, "summary": "", "count": count}] if count > 0 else []


def own_lines(finished: list[float], ready: list[float], since: float, archived: list[float] = ()) -> list[dict]:
    """Orb's own lines, after the routines': sessions that finished (unopened), delegations that became Ready and
    Stale sessions Orb archived since the owner left, one line each, none when its count is 0. The lists are those
    times."""
    out = []
    for kind, times, one, many in (("finished", finished, "1 session finished", "{} sessions finished"),
                                   ("ready", ready, "1 delegation Ready", "{} delegations Ready"),
                                   ("archived", archived, "1 old session archived", "{} old sessions archived")):
        got = [t for t in times if t > since]
        if got:
            out.append({"kind": kind, "id": kind, "title": one if len(got) == 1 else many.format(len(got)), "summary": "",
                        "count": len(got), "at": max(got)})
    return out


def _shape(since: float, back: float | None, now: float, lines: Callable[[float], list[dict]] | None) -> dict:
    got = [{k: v for k, v in x.items() if k != "at"} for x in (lines(since) if lines else [])]
    return {"since": since, "back": back, "heading": heading((back or now) - since), "lines": got[:LINES],
            "more": max(0, len(got) - LINES)}


class Clock:
    def __init__(self, path: Path) -> None:
        self.path = path
        data = config.read_state(path) or {}
        self.last_active: float | None = data.get("last_active")
        self.recap: dict | None = data.get("recap")  # {"since", "back"}: the owner is back, the card not seen yet
        self.last: dict | None = data.get("last")  # the recap before, once it was seen or expired: for the Home chat
        self.saved: float | None = self.last_active  # None: nothing written yet, the first action is

    def save(self) -> None:
        config.write_private(self.path, json.dumps({"last_active": self.last_active, "recap": self.recap, "last": self.last}))
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
        self.last, self.recap = self.recap, None
        self.save()
        return True

    def current(self, now: float | None = None, lines: Callable[[float], list[dict]] | None = None) -> dict | None:
        """The recap a page shows now: frozen once the owner is back, live while they are still away, else None.
        `lines(since)` gives what finished without the owner; the card keeps the first LINES and counts the rest."""
        now = time.time() if now is None else now
        if self.recap and now - self.recap["back"] >= RECAP_KEEP:
            self.last, self.recap = self.recap, None
            self.save()
        span = self._pending(now)
        return _shape(*span, now, lines) if span else None

    def peek(self, now: float | None = None, lines: Callable[[float], list[dict]] | None = None) -> dict | None:
        """For the Home chat: the pending recap (seen False), else the last one (seen True), else None. Only reads: the
        card's one-shot state stays as it is."""
        now = time.time() if now is None else now
        recap = self.recap if self.recap and now - self.recap["back"] < RECAP_KEEP else None
        span = (recap["since"], recap["back"]) if recap else self._pending(now) if not self.recap else None
        if span:
            return {**_shape(*span, now, lines), "seen": False}
        last = self.recap or self.last  # an expired recap nobody closed counts as the last one
        return {**_shape(last["since"], last["back"], now, lines), "seen": True} if last else None

    def _pending(self, now: float) -> tuple[float, float | None] | None:
        if self.recap:
            return self.recap["since"], self.recap["back"]
        if self.last_active is not None and now - self.last_active >= AWAY_SECONDS:
            return self.last_active, None
        return None

    def event(self, now: float | None = None, lines: Callable[[float], list[dict]] | None = None) -> dict:
        return {"type": "away_recap", "recap": self.current(now, lines)}
