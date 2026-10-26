"""Which of a repo's own Claude Code settings a session loads, and the files that decide what runs without a card.

A repo's `.claude/settings.json` (and `settings.local.json`) can carry allow rules, which approve a tool call
before Orb's `can_use_tool` sees it, and hooks, which run commands when a session starts; `.claude/skills` can
pre-allow tools and `.mcp.json` adds servers. So a session loads the repo's settings only when the owner turned
on `trustSettings` in that repo's /config, and never in a delegation's worktree (the session edits its files).
Otherwise it loads the user's own settings only, and Orb adds the repo's CLAUDE.md files to the prompt itself:
instructions are text, they approve nothing.
"""

from __future__ import annotations

import os
from pathlib import Path

from . import worktree

TRUSTED_SOURCES = ["user", "project", "local"]
USER_ONLY = ["user"]

_FILES = ("CLAUDE.md", os.path.join(".claude", "CLAUDE.md"), "CLAUDE.local.md")
FILE_MAX = 40_000  # characters per file, like a long CLAUDE.md
TOTAL_MAX = 120_000

RUNS_CODE = ("This file decides what runs without a card (Claude Code settings, hooks, skills, MCP servers, "
             "git hooks or config).")


def sources(path: str, trusted: bool) -> list[str]:
    """The setting sources for a session in path: the repo's own only when trusted and not a worktree."""
    if trusted and os.path.realpath(path) not in worktree.registered():
        return TRUSTED_SOURCES
    return USER_ONLY


def _folders(path: str) -> list[Path]:
    """The folders whose CLAUDE.md Claude Code would read, outermost first. A worktree reads its own files,
    then the folders above its repo (the worktree itself lives outside the roots)."""
    here = Path(os.path.realpath(path))
    above = Path(worktree.registered().get(str(here), str(here))).resolve().parent
    return list(reversed([here, above, *above.parents]))


def instructions(path: str) -> str:
    """The repo's CLAUDE.md files (and .claude/rules) as one block for the system prompt, or ""."""
    parts, total = [], 0
    for folder in _folders(path):
        # ~/.claude/CLAUDE.md is the user's own: it comes with the "user" source
        files = [folder / f for f in _FILES if not (folder == Path.home() and f.startswith(".claude"))]
        rules = folder / ".claude" / "rules"
        if folder == Path(os.path.realpath(path)) and rules.is_dir():
            files += sorted(rules.glob("*.md"))
        for f in files:
            try:
                if f.is_symlink() or not f.is_file():
                    continue
                text = f.read_text(errors="replace")[:FILE_MAX].strip()
            except OSError:
                continue
            if not text or total + len(text) > TOTAL_MAX:
                continue
            total += len(text)
            parts.append(f"Contents of {f} (project instructions):\n\n{text}")
    if not parts:
        return ""
    return ("Project instructions (Orb loads this repo's CLAUDE.md files itself; the repo's own Claude Code "
            "settings are not loaded):\n\n" + "\n\n".join(parts))


def runs_code(target: str) -> bool:
    """True for a path whose contents change what runs without a card."""
    parts = [p.casefold() for p in Path(target).parts]
    name = parts[-1] if parts else ""
    if name in (".mcp.json", ".claude.json"):
        return True
    if ".claude" in parts:  # its settings, hooks, skills, commands, agents and plugins; not CLAUDE.md or memory
        rest = parts[parts.index(".claude") + 1:]
        return rest[:1] in (["hooks"], ["skills"], ["commands"], ["agents"], ["plugins"]) or \
            (len(rest) == 1 and rest[0].startswith("settings") and rest[0].endswith(".json"))
    if ".git" in parts:
        rest = parts[parts.index(".git") + 1:]
        return rest[:1] == ["hooks"] or rest == ["config"]
    return False
