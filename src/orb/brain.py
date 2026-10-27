"""Second brain: "Zanotuj: …" notes and Brain Capture limits.

Notes: the server spots the trigger and queues the exact Whisper text after it. The model is
asked to save it with Brain Capture, but a PreToolUse hook puts the queued text into the call,
so the model can't rewrite it, and refuses kind="thought" when nothing was queued (AI-written
text is never stored as the user's thought; it goes in as kind="talk_summary").
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

from . import config

CAPTURE_TOOL = "mcp__claude_ai_Brain_Capture__capture"
BRAIN_READ_TOOLS = [f"mcp__claude_ai_Brain__{t}" for t in
                    ("search_notes", "read_note", "recent_notes", "list_topics", "last_curation_run", "vault_overview")]
CONNECTOR_PREFIX = "mcp__claude_ai_"  # every claude.ai connector's tools
BRAIN_PREFIXES = ("mcp__claude_ai_Brain__", "mcp__claude_ai_Brain_Capture__")
MAX_NOTE_BYTES = 4096
DAILY_LIMIT = 20
# Expiry (docs/adr/0013): the vault's curation decision of 2026-10-19 (amended 2026-10-25), skills/value.md "Expiry".
# The vault's translate actor archives the page; Orb only repeats the rule to show the window, and when the two
# disagree the vault wins (a page with `auto_archived` is expired whatever this says).
EXPIRY_DAYS = 14

_TRIGGER = re.compile(
    r"^\s*(?:zanotuj(?:\s+to)?|zapisz\s+(?:to\s+)?(?:do\s+mózgu|do\s+mozgu|w\s+notatkach|notatkę|notatke)"
    r"|notatka|note\s+(?:this|that)(?:\s+down)?|take\s+a\s+note|make\s+a\s+note)\b\s*[:,.;\-–—]*\s*",
    re.IGNORECASE,
)

NOTE_REQUEST = (
    "[Orb] The user dictated a note. Save it now with the Brain Capture tool: kind=\"thought\", "
    "text exactly as below (the dashboard puts in the exact words anyway). Don't save anything else, "
    "then confirm in one short spoken line and write nothing after it.\n<note>\n{text}\n</note>"
)


def expiry(fm: dict[str, str]) -> str:
    """The day (YYYY-MM-DD) the vault will archive this page: `curated_at` (or `created`) + EXPIRY_DAYS, for the vault
    rule's own pages only (AI-curated, not reviewed, `value_score` 4 or lower, no `owner_read`, no `human_verdict`, not
    already `auto_archived`); "" for every other page, or when the date can't be read."""
    if (fm.get("curated_by") != "ai" or fm.get("human_reviewed", "").lower() != "false" or fm.get("owner_read")
            or fm.get("human_verdict") or fm.get("auto_archived")):
        return ""
    try:
        if int(float(fm.get("value_score") or "")) > 4:
            return ""
        start = dt.date.fromisoformat((fm.get("curated_at") or fm.get("created") or "")[:10])
    except ValueError:
        return ""
    return (start + dt.timedelta(days=EXPIRY_DAYS)).isoformat()


def split_note(text: str) -> str | None:
    """The exact text after a note trigger ("Zanotuj: …", "Note this: …"), or None."""
    m = _TRIGGER.match(text)
    if not m:
        return None
    rest = text[m.end():].strip()
    return rest or None


class CaptureGuard:
    """Queued notes per session, plus the 4 KB / 20-per-UTC-day limits (counted on disk)."""

    def __init__(self, state: Path) -> None:
        self.state = state
        self.pending: dict[str, list[str]] = {}

    # -- daily count --------------------------------------------------------------------

    def _today(self) -> str:
        return dt.datetime.now(dt.UTC).date().isoformat()

    def count(self) -> int:
        try:
            d = json.loads(self.state.read_text())
        except (OSError, ValueError):
            return 0
        return int(d.get("count", 0)) if d.get("date") == self._today() else 0

    def record(self) -> None:
        n = self.count() + 1
        config.write_private(self.state, json.dumps({"date": self._today(), "count": n}))

    def refuse(self, text: str) -> str | None:
        """Why a capture can't be made, or None."""
        if len(text.encode()) > MAX_NOTE_BYTES:
            return f"the note is {len(text.encode())} bytes; the limit is {MAX_NOTE_BYTES}"
        if self.count() >= DAILY_LIMIT:
            return f"today's limit of {DAILY_LIMIT} captures is reached (resets at midnight UTC)"
        return None

    # -- queued notes -----------------------------------------------------------------------

    def queue(self, session: str, text: str) -> None:
        self.pending.setdefault(session, []).append(text)

    def drop(self, session: str) -> list[str]:
        return self.pending.pop(session, [])

    def pre_capture(self, session: str, tool_input: dict[str, Any]) -> dict:
        """PreToolUse decision for a Brain Capture call."""
        kind = tool_input.get("kind")
        if kind == "thought":
            queue = self.pending.get(session) or []
            if not queue:
                return deny("kind=\"thought\" is only for the user's own dictated words, which the dashboard "
                            "captures itself. Save text you wrote or found as kind=\"talk_summary\".")
            text = queue[0]
            if why := self.refuse(text):
                return deny(f"Brain Capture refused: {why}.")
            queue.pop(0)
            return allow({**tool_input, "kind": "thought", "text": text})
        if why := self.refuse(str(tool_input.get("text") or "")):
            return deny(f"Brain Capture refused: {why}.")
        return {}  # other kinds: the normal approval flow decides


def allow(updated_input: dict | None = None) -> dict:
    out: dict[str, Any] = {"hookEventName": "PreToolUse", "permissionDecision": "allow"}
    if updated_input is not None:
        out["updatedInput"] = updated_input
    return {"hookSpecificOutput": out}


def connector_env(s) -> dict[str, str]:
    """A session's claude.ai connectors: none unless Brain or the other connectors are on (s: the settings;
    the work profile keeps both off)."""
    return {} if s["brain"] or s["connectors"] else {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"}


def connector_allowed(name: str, s) -> bool:
    """A claude.ai connector tool a session may call: Brain's with settings["brain"], any with "connectors"."""
    return bool(s["connectors"] or (s["brain"] and name.startswith(BRAIN_PREFIXES)))


def deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def ask(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                   "permissionDecisionReason": reason}}


def brain_prompt(vault: Path | None, protected: tuple[str, ...] = ()) -> str:
    """System-prompt part for the claude.ai "Brain" / "Brain Capture" connectors (settings["brain"])."""
    keep = ", ".join(f"{d}/" for d in protected)
    vault_line = (f"- Prefer Brain Capture over writing files in the vault. If you must change files in {vault}:\n"
                  "  run git pull --rebase first, make one commit, never force-push.\n"
                  f"  Don't edit {keep + ' or ' if keep else ''}any CLAUDE.md there without the user's approval.\n") if vault else ""
    return f"""\
# Second brain
The user's second brain is reachable through the claude.ai "Brain" (read) and "Brain Capture" (write)
tools in every folder.
- "What's new in my brain?" / "Co nowego w mózgu?": call recent_notes and last_curation_run. Spoken part:
  2–3 sentences. Written part: note titles only, grouped under **Curated**, **Your notes**, **Saved
  captures**, **Perspectives (unverified)**. "What did the AI curate last night?": last_curation_run.
  These questions are read-only.
- Notes the user dictates ("Note this: …", "Zanotuj: …") are saved by Orb; follow its instructions.
  Never save text you wrote, found or summarised as kind="thought": use kind="talk_summary".
{vault_line}"""
