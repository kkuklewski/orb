"""Second brain: "Zanotuj: …" notes, Brain Capture limits, and the vault's write rules.

Notes: the server spots the trigger and queues the exact Whisper text after it. The model is
asked to save it with Brain Capture, but a PreToolUse hook puts the queued text into the call,
so the model can't rewrite it, and refuses kind="thought" when nothing was queued (AI-written
text is never stored as the user's thought; it goes in as kind="talk_summary").

Vault rules (only when a vault is set up): edits to any CLAUDE.md or to the folders listed in
settings["vault_protected"] always need an approval card, and no force-push.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import shlex
from pathlib import Path
from typing import Any

CAPTURE_TOOL = "mcp__claude_ai_Brain_Capture__capture"
BRAIN_READ_TOOLS = [f"mcp__claude_ai_Brain__{t}" for t in
                    ("search_notes", "read_note", "recent_notes", "list_topics", "last_curation_run", "vault_overview")]
MAX_NOTE_BYTES = 4096
DAILY_LIMIT = 20
FILE_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")

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
        self.state.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state.with_suffix(".tmp")
        tmp.write_text(json.dumps({"date": self._today(), "count": n}))
        os.replace(tmp, self.state)

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


def deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def ask(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                   "permissionDecisionReason": reason}}


_FORCE_RAW = re.compile(r"\bpush\b[^;&|\n]*?(\s--force\b|\s--force-with-lease\b|\s-[A-Za-z]*f[A-Za-z]*\b|\s\+\S)")
_PLAIN_PUSH = re.compile(
    r"^\s*git\s+push(?:\s+(?:-u|--set-upstream|-v|--verbose|-q|--quiet|--tags|--follow-tags|-n|--dry-run))*"
    r"(?:\s+[A-Za-z0-9._/][A-Za-z0-9._/-]*){0,2}\s*$"
)
_CONFIG_TRICKS = re.compile(r"\bgit\s+config\b|\balias\.|\bremote\.|\bGIT_[A-Z_]*=|\s-c\s|--config-env")


def push_decision(cmd: str) -> str | None:
    """'deny' (force), 'ask' (anything but a literal plain push) or None, for a Bash command.

    Fails closed: if "push" appears anywhere, every segment that mentions it must be a literal
    `git push [-u|-v|-q|--tags|-n] [remote] [branch]`, and the command must not touch git config,
    aliases, remote settings or GIT_* variables. Anything else needs a card. (A remote already set
    up as a mirror in the repo's config can't be seen from the command; a pre-push hook would.)
    """
    if re.search(r"[\\'\"]", cmd):
        stripped = re.sub(r"[\\'\"]", "", cmd)  # "pu\sh", "'push'": quoting can't hide the word
        if re.search(r"\bpush\b", stripped) and not re.search(r"\bpush\b", cmd):
            return "ask"
        cmd_for_force = stripped
    else:
        cmd_for_force = cmd
    if re.search(r"\bpush\b", cmd_for_force) and _FORCE_RAW.search(cmd_for_force):
        return "deny"
    if re.search(r"\bgit\b", cmd) and re.search(r"[$`*?]|\beval\b|\bxargs\b|\b(?:ba|z|da|fi)?sh\s+-\w*c\b", cmd):
        return "ask"  # git plus shell expansion: what runs can't be read from the text
    if not re.search(r"\bpush\b", cmd):
        return None
    if _CONFIG_TRICKS.search(cmd):
        return "ask"
    for segment in re.split(r"&&|\|\||;|\||\n", cmd):
        if re.search(r"\bpush\b", segment) and not _PLAIN_PUSH.match(segment):
            return "ask"
    return None


def vault_rule(vault: Path | None, tool: str, tool_input: dict[str, Any], cwd: str | None = None,
               protected: tuple[str, ...] = ()) -> dict:
    """PreToolUse decision from the vault's rules ({} = no objection, also when there is no vault)."""
    if vault is None:
        return {}
    if tool in FILE_TOOLS:
        raw = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        try:
            p = Path(raw).expanduser()
            if not p.is_absolute():
                p = Path(cwd or ".") / p
            full = p.resolve()
            root = vault.resolve()
        except (OSError, RuntimeError):
            return ask(f"Could not resolve {raw}; you must approve this change.")
        # macOS paths are case-insensitive: compare casefolded.
        if not str(full).casefold().startswith(str(root).casefold() + os.sep) and str(full).casefold() != str(root).casefold():
            return {}
        rel = Path(str(full)[len(str(root)):].lstrip(os.sep))
        if rel.name.casefold() == "claude.md" or (rel.parts and rel.parts[0].casefold() in {d.casefold() for d in protected}):
            return ask(f"{rel} is a protected part of the vault; you must approve this change.")
        return {}
    if tool == "Bash":
        verdict = push_decision(str(tool_input.get("command", "")))
        if verdict == "deny":
            return deny("Force-pushing the notes vault is blocked in Orb. Do it from a terminal if you really mean it.")
        if verdict == "ask":
            return ask("This push is not a plain `git push` (unusual flag, refspec, wrapper or git config); "
                       "you must approve it.")
    return {}


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
