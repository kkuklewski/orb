"""Vault sync: a read-only look at the local vault clone against its remote (ticket 819, ADR 0007). Counts only, never a
path or file name: behind, ahead, changed, unmerged paths, the merge / rebase / cherry-pick in progress, the last fetch.

Read-only: `status -b`, `ls-files -u` and `rev-parse --git-path`, each with `--no-optional-locks` (no index.lock),
fsmonitor and hooks off and no terminal prompt, and only after `unsafe_config` found nothing. No fetch: "behind" is
as of the last fetch. Orb reports the clone, it never fixes it (no pull, merge, reset, stash or fetch)."""

from __future__ import annotations

import fnmatch
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import forget

GIT_TIMEOUT = 10
READS = ("config", "rev-parse", "ls-files", "status")  # the only git commands this module runs
NOT_REPO = "the vault isn't a git repository"
# Vault-local git config that makes git run a program (or send the push elsewhere): a session could have written it, so
# Orb's own git calls refuse to run while it is set (`unsafe_config`). Matched on lower-case names with fnmatch.
UNSAFE_GIT = ("core.fsmonitor", "core.sshcommand", "core.gitproxy", "core.askpass", "core.alternaterefscommand",
              "filter.*", "include.*", "includeif.*", "credential.*", "gpg.*", "protocol.*", "url.*",
              "remote.*.receivepack", "remote.*.uploadpack", "remote.*.proxy")
# What git leaves in the git dir while an operation waits for the owner, in the order checked.
OPERATIONS = (("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"), ("rebase-apply", "rebase"),
              ("CHERRY_PICK_HEAD", "cherry-pick"))


def _git(vault: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "--no-optional-locks", "-C", str(vault), "-c", "core.fsmonitor=false",
                           "-c", "core.hooksPath=/dev/null", *args], capture_output=True, text=True,
                          timeout=GIT_TIMEOUT, env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"})


def unsafe_config(vault: Path) -> str | None:
    """Why Orb's git calls in the vault won't run, or None: the vault's own (local or worktree) git config sets a key
    from UNSAFE_GIT. Reading the config runs nothing."""
    try:
        r = _git(vault, "config", "--list", "--name-only", "--show-scope")
    except (OSError, subprocess.SubprocessError):
        return "git didn't answer"
    if r.returncode:
        return NOT_REPO
    for line in r.stdout.splitlines():
        scope, _, key = line.partition("\t")
        if scope in ("local", "worktree") and any(fnmatch.fnmatchcase(key.lower(), pat) for pat in UNSAFE_GIT):
            return f"the vault's git config sets {key}; Orb doesn't run git there while it does"
    return None


@dataclass(frozen=True)
class Health:
    ahead: int = 0
    behind: int = 0
    changed: int = 0
    unmerged: int = 0  # unique paths with a conflict
    operation: str = ""  # merge | rebase | cherry-pick, "" when none
    fetched: float | None = None  # FETCH_HEAD's time; None = never fetched
    why: str = ""  # set when Orb couldn't check (a git config key, git didn't answer); the counts are then 0

    @property
    def conflicted(self) -> bool:
        """Writes refuse: a path is unmerged or an operation waits. A dirty tree alone is not conflicted."""
        return bool(self.unmerged or self.operation)

    @property
    def diverged(self) -> bool:
        return self.ahead > 0 and self.behind > 0

    def refusal(self) -> str:
        n = self.unmerged
        count = f" ({n} conflict{'' if n == 1 else 's'})" if n else ""
        return f"Your vault is mid-{self.operation or 'merge'}{count}; Orb writes nothing there until you finish it."


def health(vault: Path | None, full: bool = True) -> Health | None:
    """The clone's state, or None when there is no vault or it isn't a git repo. `full=False` is the check before a
    write: only what makes it conflicted (no status, no fetch time)."""
    if not vault:
        return None
    why = unsafe_config(vault)
    if why == NOT_REPO:
        return None
    if why:
        return Health(why=why)
    names = [n for n, _ in OPERATIONS] + (["FETCH_HEAD"] if full else [])
    try:
        paths = _git(vault, "rev-parse", *(a for n in names for a in ("--git-path", n)))
        if paths.returncode:
            return None
        unmerged = _git(vault, "ls-files", "-u", "-z")
        status = _git(vault, "status", "--porcelain=v1", "-b", "--ignore-submodules=all") if full else None
    except (OSError, subprocess.SubprocessError):
        return Health(why="git didn't answer")
    if unmerged.returncode or (status and status.returncode):
        return Health(why="git didn't answer")
    found = dict(zip(names, (vault / p for p in paths.stdout.splitlines())))
    op = next((label for name, label in OPERATIONS if found[name].exists()), "")
    n = len({e.split("\t", 1)[1] for e in unmerged.stdout.split("\0") if "\t" in e})
    if not status:
        return Health(unmerged=n, operation=op)
    s = forget.parse_status(status.stdout)
    try:
        fetched: float | None = found["FETCH_HEAD"].stat().st_mtime
    except OSError:
        fetched = None
    return Health(ahead=s["ahead"] or 0, behind=s["behind"], changed=s["changed"], unmerged=n, operation=op,
                  fetched=fetched)
