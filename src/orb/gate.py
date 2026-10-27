"""Tool gate: one decision for every tool call of a session (ADR 0011, extending ADR 0005 and 0009).

A session has one Gate; `decide(tool, inp)` is all a caller needs, and the checks run in this order:
1. a claude.ai connector that is off: deny (Brain's tools only, unless the owner turned the others on);
2. Brain Capture: the Capture guard's verdict (a dictated thought runs with the user's own words);
3. `continue_in_repo` and the tracker writes: always ask, whatever the permission mode;
4. the repo fence and the vault rules (`vault_rule`), strictest first: a deny is final, an ask is never covered;
5. the session's grant (`cover`, set while a delegation or a drop owns the session): a call it covers is allowed
   with its safe input (a declared command in the sandbox, git with the repo's hooks off);
6. anything else: no objection, the permission mode and the approval card decide.
Cards, speech, notices and undo stay with the session. The SDK's hook dict is built only by `hook_output`.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from . import desk, handoff, settings, shell
from .brain import CAPTURE_TOOL, CONNECTOR_PREFIX, CaptureGuard, ask, connector_allowed, deny
from .fence import Fence, strictest
from .grant import Cover

Kind = Literal["allow", "ask", "deny", "pass"]
CONNECTORS_OFF = "claude.ai connectors other than Brain are off in Orb (settings: connectors)."
_FILE_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")


@dataclass(frozen=True)
class Decision:
    kind: Kind  # pass: no objection; the permission mode and the card decide
    reason: str = ""  # deny: what to tell Claude and the owner; ask: the card's note
    input: dict[str, Any] | None = None  # allow: the input the call runs with (None: as Claude sent it)
    covered: bool = False  # allowed by the session's grant
    title: str = ""  # a tracker write: the task's title, for the card


PASS = Decision("pass")


class Gate:
    def __init__(self, fence: Fence, session: str, cwd: str, guard: CaptureGuard,
                 task_title: Callable[[object], str] | None = None) -> None:
        self.fence = fence
        self.session = session  # the session's key: the Capture guard queues dictated notes per session
        self.cwd = cwd
        self.guard = guard
        self.task_title = task_title  # a tracker task's title by id (best effort), for a tracker write's card
        self.cover: Cover | None = None  # a delegation's or a drop's grant: never stored or carried over

    def decide(self, tool: str, inp: dict[str, Any]) -> Decision:
        if tool.startswith(CONNECTOR_PREFIX) and not connector_allowed(tool, settings.settings):
            return Decision("deny", CONNECTORS_OFF)
        if tool == CAPTURE_TOOL:
            verdict = _decision(self.guard.pre_capture(self.session, inp))
            return verdict if verdict.kind != "pass" else self._covered(tool, inp)
        if tool == handoff.TOOL:  # it starts work in another repo
            return _decision(handoff.ask(inp))
        if tool in desk.WRITE_TOOLS:  # it changes a task in the tracker
            title = self.task_title(inp.get("id")) if self.task_title else ""
            ask = _decision(desk.ask(tool, inp, title))
            return Decision("ask", ask.reason, title=title)
        verdict = _decision(strictest(self.fence.rule(tool, inp), vault_rule(
            settings.settings.vault(), tool, inp, cwd=self.cwd, protected=tuple(settings.settings["vault_protected"]))))
        return verdict if verdict.kind != "pass" else self._covered(tool, inp)

    def _covered(self, tool: str, inp: dict[str, Any]) -> Decision:
        if self.cover is None or not self.cover.covers(tool, inp):
            return PASS
        return Decision("allow", input=self.cover.safe_input(tool, inp), covered=True)


def hook_output(d: Decision) -> dict:
    """The PreToolUse hook's answer for a decision ({} = no objection)."""
    if d.kind == "pass":
        return {}
    out: dict[str, Any] = {"hookEventName": "PreToolUse", "permissionDecision": d.kind}
    if d.reason:
        out["permissionDecisionReason"] = d.reason
    if d.input is not None:
        out["updatedInput"] = d.input
    return {"hookSpecificOutput": out}


def vault_rule(vault: Path | None, tool: str, tool_input: dict[str, Any], cwd: str | None = None,
               protected: tuple[str, ...] = ()) -> dict:
    """PreToolUse decision from the vault's rules ({} = no objection, also when there is no vault): edits to any
    CLAUDE.md or to the folders in settings["vault_protected"] always need a card, and no force-push."""
    if vault is None:
        return {}
    if tool in _FILE_TOOLS:
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
        verdict = shell.read(str(tool_input.get("command", ""))).push
        if verdict == "deny":
            return deny("Force-pushing the notes vault is blocked in Orb. Do it from a terminal if you really mean it.")
        if verdict == "ask":
            return ask("This push is not a plain `git push` (unusual flag, refspec, wrapper or git config); "
                       "you must approve it.")
    return {}


def _decision(out: dict) -> Decision:
    """A Decision from a hook dict (the fence, the vault rules, the Capture guard and the cards still build them)."""
    spec = out.get("hookSpecificOutput", {})
    kind = spec.get("permissionDecision")
    if kind not in ("allow", "ask", "deny"):
        return PASS
    return Decision(kind, spec.get("permissionDecisionReason", ""), spec.get("updatedInput"))
