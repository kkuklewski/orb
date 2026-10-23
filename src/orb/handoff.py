"""Hand a piece of work to a new session in another repo: "ok, go to that repo and do it for me".

The session's Claude calls `continue_in_repo(repo, brief)`. It goes through the usual Allow/Deny card, so the
user approves where it goes. The hub then opens a fresh session in that repo (the page follows it), and the
brief is its first request; the repo fence and approvals of that session apply as for any session.
"""

from __future__ import annotations

from pathlib import Path

SERVER = "orb"
NAME = "continue_in_repo"
TOOL = f"mcp__{SERVER}__{NAME}"

PROMPT = f"""\
# Continuing in another repo
You work in this session's repo only. When the work belongs in another repo and the user says to go
there and do it ("ok, go to that repo", "zrób to w tamtym repo"), call `{NAME}` with the repo's name and
a self-contained `brief`: the task, what you already found (file paths, causes), what to do and what
not to touch. The new session starts cold; it cannot see this conversation. Don't try to edit the other
repo from here. After the call, say in one short line which repo you handed it to."""

DESCRIPTION = ("Open a new session in another repo and start it on `brief`. Use when the user wants the work "
               "done in a different repo than this session's. `repo` is the repo's name (e.g. its folder "
               "name or owner/name).")


class HandoffError(Exception):
    """Refused: the text goes back to the model, which tells the user."""


def _names(f: dict) -> set[str]:
    label = str(f.get("label") or "")
    return {label.lower(), label.rsplit("/", 1)[-1].lower(), Path(f["path"]).name.lower(), str(f["path"]).lower()}


def resolve(items: list[dict], query: str) -> dict:
    """The one folder `query` names: an exact name first, then a unique partial match."""
    q = " ".join(query.lower().split()).strip("/ ")
    if not q:
        raise HandoffError("Say which repo.")
    exact = [f for f in items if q in _names(f)]
    if len(exact) == 1:
        return exact[0]
    partial = exact or [f for f in items if any(q in n for n in _names(f))]
    if len(partial) == 1:
        return partial[0]
    if not partial:
        raise HandoffError(f"No repo matches {query!r}. Known repos: {', '.join(sorted(f['label'] for f in items)[:30])}.")
    raise HandoffError(f"{query!r} matches several repos: {', '.join(f['label'] + ' (' + f['rel'] + ')' for f in partial[:8])}. "
                       "Ask the user which one, or pass the full path.")


def result(text: str, error: bool = False) -> dict:
    """An MCP tool result carrying one line of text."""
    return dict(content=[dict(type="text", text=text)], is_error=error)


def ask(inp: dict) -> dict:
    """The PreToolUse decision for the tool: always a card, whatever the session's permission mode."""
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                   "permissionDecisionReason": f"Claude wants to continue in another repo: {inp.get('repo') or '?'}."}}
