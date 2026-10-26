"""Grant: the owner's one approval for what a delegation may do in its own worktree (ADR 0005).

A grant is attached to one session when the owner allows it on the Delegate card and is never stored or
carried to another session. Before the tool gate raises an approval card it asks `decide`:
1. the repo fence (and the vault rules) run first; a deny is final and an "ask" always raises a card;
2. covered calls pass without a card: file edits inside the worktree, Bash commands that are exactly one of
   the repo's declared test or build commands, `git add` / `git commit` while the worktree is on the
   delegation branch, and `git push` of that branch / `gh pr create` only when outward steps are allowed;
3. everything else raises the normal card.
Bash is matched word by word; anything with a shell operator, substitution or redirection is not covered
(the declared commands excepted: the owner typed those exactly), and git / gh flags are allowlisted. Edits
under `.git` are never covered: its config and gitdir decide which code a covered git command runs. A
covered `git commit` / `git push` runs with the repo's hooks off (`safe_input`): hooks are files the session
could have edited (.husky/, lint-staged in package.json), so they would run its code without a card.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from .fence import Fence

_EDIT_TOOLS = {"Edit": "file_path", "Write": "file_path", "MultiEdit": "file_path", "NotebookEdit": "notebook_path"}
_SHELL = re.compile(r"[;&|<>`$(){}\\\n\r*?\[\]~]")
# `git commit -m "$(cat <<'EOF' … EOF)"`, the way Claude Code writes a commit: a quoted heredoc never expands.
_HEREDOC_COMMIT = re.compile(r"git commit((?: -[A-Za-z-]+)*) -m \"\$\(cat <<'EOF'\n(.*)\nEOF\n\)\"", re.DOTALL)
_PUSH_FLAGS = {"-u", "--set-upstream"}
_NO_HOOKS = "-c core.hooksPath=/dev/null "
# Flags a covered command may carry; the *_VALUES ones take the next word. Anything else raises a card
# (e.g. `git commit -F <file>`, `gh pr create --repo <other> / --body-file <file>`).
_ADD_FLAGS = {"-A", "--all", "-u", "--update", "--"}
_COMMIT_FLAGS = {"-a", "--all", "-s", "--signoff", "-n", "--no-verify", "--"}
_COMMIT_VALUES = {"-m", "--message", "-am"}
_PR_FLAGS = {"-d", "--draft", "-f", "--fill"}
_PR_VALUES = {"-t", "--title", "-b", "--body", "-B", "--base", "-H", "--head"}

Decision = Literal["deny", "card", "allow"]


class Cover(Protocol):
    """What `decide` asks of a grant: a delegation's Grant, or a drop's (intake.DropGrant, ADR 0009)."""
    def covers(self, tool: str, inp: dict[str, Any]) -> bool: ...
    def safe_input(self, tool: str, inp: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class Grant:
    worktree: str  # the delegation's worktree (resolved)
    branch: str  # the delegation branch
    commands: tuple[str, ...] = ()  # the repo's declared test and build commands; none declared: no cover
    outward: bool = False  # push and PR: the repo's outward-steps setting, always off in a client folder

    def __post_init__(self) -> None:
        self.worktree = os.path.realpath(self.worktree)
        self.commands = tuple(c for c in (_norm(c) for c in self.commands) if c)

    def covers(self, tool: str, inp: dict[str, Any]) -> bool:
        if tool in _EDIT_TOOLS:
            raw = inp.get(_EDIT_TOOLS[tool])
            if not raw:
                return False
            path = os.path.realpath(os.path.join(self.worktree, os.path.expanduser(str(raw))))
            # never .git: its gitdir and config decide which code a covered git command runs
            return _inside(path, self.worktree) and ".git" not in os.path.relpath(path, self.worktree).casefold().split(os.sep)
        if tool != "Bash":
            return False
        cmd = _norm(str(inp.get("command", "")))
        if cmd and cmd in self.commands:
            return True
        if m := _HEREDOC_COMMIT.fullmatch(cmd.strip()):
            flags, body = m.group(1).split(), m.group(2)
            return "EOF" not in body.split("\n") and all(_commit_flag(f) for f in flags) and self.on_branch()
        words = _words(cmd)
        if not words:
            return False
        if words[:2] == ["git", "add"]:
            return _args_ok(words[2:], _ADD_FLAGS, set()) and self.on_branch()
        if words[:2] == ["git", "commit"]:
            return _args_ok(words[2:], _COMMIT_FLAGS, _COMMIT_VALUES) and self.on_branch()
        if words[:2] == ["git", "push"]:
            return self.outward and self._push_ok(words[2:]) and self.on_branch()
        if words[:3] == ["gh", "pr", "create"]:
            args = words[3:]
            heads = _flag_values(args, "--head", "-H")
            return (self.outward and _args_ok(args, _PR_FLAGS, _PR_VALUES, positional=False)
                    and heads in ([], [self.branch]) and self.on_branch())
        return False

    def safe_input(self, tool: str, inp: dict[str, Any]) -> dict[str, Any]:
        """The input a covered call runs with: git commit / push with the repo's hooks turned off."""
        cmd = str(inp.get("command", "")) if tool == "Bash" else ""
        if re.match(r"git (commit|push)\b", cmd.strip()):
            return {**inp, "command": "git " + _NO_HOOKS + cmd.strip()[4:]}
        return inp

    def _push_ok(self, args: list[str]) -> bool:
        """`git push [-u] [<remote> [<branch> | HEAD:<branch>]]`: this branch to a named remote, never a URL,
        force or delete."""
        flags = [a for a in args if a.startswith("-")]
        pos = [a for a in args if not a.startswith("-")]
        if any(f not in _PUSH_FLAGS for f in flags) or len(pos) > 2:
            return False
        if pos and pos[0] not in self._remotes():
            return False
        return len(pos) < 2 or pos[1] in (self.branch, f"HEAD:{self.branch}", f"{self.branch}:{self.branch}")

    def _remotes(self) -> set[str]:
        try:
            out = subprocess.run(["git", "-C", self.worktree, "remote"], capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            return set()
        return set(out.stdout.split()) if out.returncode == 0 else set()

    def on_branch(self) -> bool:
        """True while the worktree has the delegation branch checked out."""
        try:
            out = subprocess.run(["git", "-C", self.worktree, "symbolic-ref", "--short", "HEAD"],
                                 capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            return False
        return out.returncode == 0 and out.stdout.strip() == self.branch


def decide(rule: dict, grant: Cover | None, tool: str, inp: dict[str, Any]) -> Decision:
    """deny (the fence's word is final), allow (the grant covers it) or card (ask the owner)."""
    verdict = rule.get("hookSpecificOutput", {}).get("permissionDecision")
    if verdict == "deny":
        return "deny"
    if verdict == "ask" or grant is None:
        return "card"
    return "allow" if grant.covers(tool, inp) else "card"


def for_repo(fence: Fence, worktree: str, branch: str, outward: bool, commands: list[str]) -> Grant:
    """The grant for a delegation of the repo behind `fence`: outward steps never in a client folder."""
    return Grant(worktree, branch, tuple(commands), outward and not fence.in_client())


def _norm(cmd: str) -> str:
    return " ".join(cmd.split()) if "\n" not in cmd.strip() else cmd.strip()


def _inside(p: str, root: str) -> bool:
    p, root = p.casefold(), root.casefold()  # macOS paths are case-insensitive
    return p == root or p.startswith(root.rstrip(os.sep) + os.sep)


def _words(cmd: str) -> list[str]:
    """The command's words, or [] when it has any shell operator, expansion or git global option."""
    if not cmd or _SHELL.search(re.sub(r"'[^']*'|\"[^\"$`\\]*\"", "q", cmd)):
        return []
    try:
        words = shlex.split(cmd)
    except ValueError:
        return []
    return words


def _args_ok(args: list[str], flags: set[str], values: set[str], positional: bool = True) -> bool:
    """True when every flag is allowlisted (a value flag eats the next word) and positionals are allowed."""
    i = 0
    while i < len(args):
        a = args[i]
        name = a.split("=", 1)[0] if a.startswith("--") else a
        if name in values:
            i += 1 if "=" in a else 2
            continue
        if a.startswith("-") and a not in flags:
            return False
        if not a.startswith("-") and not positional:
            return False
        i += 1
    return i == len(args)


def _commit_flag(flag: str) -> bool:
    return flag in {"-a", "--all", "-s", "--signoff", "--no-verify", "-n"}


def _flag_values(args: list[str], *names: str) -> list[str]:
    """Every value given to the flag (gh keeps the last one, so a repeat must not slip past)."""
    out = []
    for i, a in enumerate(args):
        for n in names:
            if a == n:
                out.append(args[i + 1] if i + 1 < len(args) else "")
            elif a.startswith(n + "="):
                out.append(a.split("=", 1)[1])
    return out
