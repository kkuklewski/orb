"""Slash commands typed in the composer, like Claude Code's terminal.

Claude Code itself expands `/skill args`, plugin skills and its own built-ins (`/compact`,
`/context`, `/usage`…) when they arrive as a prompt, so most commands are sent as typed. A few
map to things the dashboard already does and run here instead, without a model call
(`LOCAL`). The menu's list comes from the session's Claude Code (`get_server_info()` after
connect, then `commands_changed` messages), merged with `LOCAL`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

# Handled by the dashboard, never sent to the model. They replace Claude Code's own of the
# same name, which would change the CLI behind the dashboard's back (/model) or need a terminal.
LOCAL: tuple[dict, ...] = (
    {"name": "clear", "description": "Start a fresh session in this folder (like New session; the old one keeps running)",
     "argumentHint": ""},
    {"name": "model", "description": "Front model for this folder: haiku (cheapest), sonnet (fast, hands coding to Opus) or opus",
     "argumentHint": "[haiku|sonnet|opus]"},
    {"name": "mcp", "description": "MCP servers of this session: status and reconnect", "argumentHint": ""},
    {"name": "rewind", "description": "Undo the file changes of the last request (asks first)", "argumentHint": ""},
    {"name": "today", "description": "Home chat: what to do first today, from your tasks, routines and repos", "argumentHint": ""},
    {"name": "standup", "description": "Home chat: a short standup from your recent sessions, open work and tasks", "argumentHint": ""},
    {"name": "task", "description": "Home chat: look at one Vikunja task and say what to do about it", "argumentHint": "<id>"},
    {"name": "config", "description": "Settings of this repo's sessions (not your global Claude Code settings)",
     "argumentHint": "[permissionMode=default|auto|plan] [model=haiku|sonnet|opus]"},
)

# /config keys the dashboard keeps per repo (folder), like the header chips, with the values each takes.
# Claude Code's own /config would rewrite ~/.claude/settings.json for every session on the Mac.
CONFIG_KEYS: dict[str, tuple[str, ...]] = {
    "permissionMode": ("default", "auto", "plan"),
    "model": ("haiku", "sonnet", "opus"),
}
LOCAL_NAMES = frozenset(c["name"] for c in LOCAL)

# Bound to a real terminal; the init message reports the current list (terminal_slash_commands).
TERMINAL_ONLY = frozenset({"doctor", "color", "focus", "reload-plugins", "exit", "quit", "vim", "terminal-setup"})

# Account-wide, and Claude Code runs them at once with no approval card: auto-mode setup and
# paid usage credits. Terminal only.
BLOCKED = frozenset({"auto-mode-setup", "usage-credits", "extra-usage"})

DESCRIPTION_MAX = 200

# "/name" or "/name args"; the name stops at whitespace, so a path like "/Users/x" is not a command.
_COMMAND = re.compile(r"^/([A-Za-z0-9_][\w:.\-]*)(?:\s+(.*))?$", re.DOTALL)


def parse(text: str) -> tuple[str, str] | None:
    """'/vikunja-todo  extra words' -> ('vikunja-todo', 'extra words'); anything else -> None."""
    m = _COMMAND.match(text.strip())
    if not m:
        return None
    return m.group(1), (m.group(2) or "").strip()


def is_command(text: str) -> bool:
    return parse(text) is not None


def local_command(text: str) -> tuple[str, str] | None:
    """A command the dashboard runs itself: (name, args), else None."""
    p = parse(text)
    if p and p[0].lower() in LOCAL_NAMES:
        return p[0].lower(), p[1]
    return None


def blocked(text: str) -> str | None:
    """The name of a command never passed on to Claude Code (BLOCKED, and /config, which the
    dashboard runs itself when typed), else None."""
    p = parse(text)
    return p[0].lower() if p and p[0].lower() in BLOCKED | {"config"} else None


def parse_config(args: str) -> tuple[dict[str, str], list[str]]:
    """'permissionMode=plan model=opus' -> ({'permissionMode': 'plan', 'model': 'opus'}, problems).
    Keys match case-insensitively; anything unknown or out of range is a problem and changes nothing."""
    keys = {k.lower(): k for k in CONFIG_KEYS}
    changes: dict[str, str] = {}
    problems: list[str] = []
    for word in args.split():
        name, sep, value = word.partition("=")
        key = keys.get(name.lower())
        if not sep or key is None:
            problems.append(f"{word}: not a repo setting")
        elif value.lower() not in CONFIG_KEYS[key]:
            problems.append(f"{key}={value}: use {'|'.join(CONFIG_KEYS[key])}")
        else:
            changes[key] = value.lower()
    return (changes if not problems else {}), problems


def _clean(desc: object) -> str:
    d = " ".join(str(desc or "").split())
    return d if len(d) <= DESCRIPTION_MAX else d[: DESCRIPTION_MAX - 1].rstrip() + "…"


def merge(cli: Iterable[object] | None, terminal: Iterable[str] = ()) -> list[dict]:
    """The menu: dashboard commands first, then Claude Code's (skills, plugin skills, built-ins)
    in its order, without terminal-only and internal ones. Entries may be dicts
    ({name, description, argumentHint}) or bare names (the init message's slash_commands)."""
    hidden = TERMINAL_ONLY | BLOCKED | {t.lstrip("/") for t in terminal}
    out = [{**c, "local": True} for c in LOCAL]
    seen = set(LOCAL_NAMES)
    for c in cli or ():
        if isinstance(c, str):
            c = {"name": c}
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "").lstrip("/")
        if not name or name in seen or name in hidden or name.startswith("_"):
            continue
        seen.add(name)
        out.append({"name": name, "description": _clean(c.get("description")),
                    "argumentHint": _clean(c.get("argumentHint"))})
    return out


_NAME_TAG = re.compile(r"<command-name>\s*/?([^<\s]+)\s*</command-name>")
_ARGS_TAG = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)


def from_transcript(content: str) -> str | None:
    """A slash command as Claude Code stores it ('<command-name>/x</command-name>…<command-args>a</command-args>')
    -> '/x a', for the history after a restart. None for other text."""
    m = _NAME_TAG.search(content)
    if not m:
        return None
    a = _ARGS_TAG.search(content)
    args = " ".join(a.group(1).split()) if a else ""
    return f"/{m.group(1)}" + (f" {args}" if args else "")
