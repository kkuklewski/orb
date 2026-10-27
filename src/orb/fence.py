"""Repo fence: a session works in its own repo and doesn't wander into others.

PreToolUse decision for file tools (Read, Glob, Grep, Edit, Write, ...) and Bash commands:
1. deny, always: secret files (.env, keys, credentials, ~/.ssh, ~/.aws) and any secrets/ folder at the
   top of a root (the folders the user gave Orb in the onboarding).
2. deny: a client folder (settings["client_dirs"]) from a session that wasn't opened inside it.
3. ask: any other repo inside the roots; the card and the spoken prompt say where it goes. In the work profile
   (settings.py) every other repo is fenced like a client folder: denied, and the vault session only reads.
With a notes vault set up, the vault session is the hub: it may read client folders too (with a card),
but never change them; only a Bash command made of plain read-only commands counts as reading.
Paths outside the roots get no objection here (the normal approval flow decides).
A delegation's worktree (registered in worktrees.json, outside the roots) counts as part of its repo: the
repo's own sessions work in it freely, other sessions see that repo, and a session opened in a worktree is
in that repo (client folders included) but asks before reaching the owner's checkout or another worktree.

Bash commands are read by `shell.py` for path-like words, following `cd` / `pushd`. That stops a session that
drifts; it is not proof against a command built to hide a path (variables, base64), and the
approval card stays the last line.
"""

from __future__ import annotations

import fnmatch
import glob
import itertools
import os
import re
from pathlib import Path
from typing import Any

from . import config, settings, shell, trust, worktree
from .brain import ask, deny
from .folders import _git_config_remote, remote_label

SECRETS_DIR = "secrets"
SECRET_FILES = tuple(Path.home() / f for f in (
    ".claude/.credentials.json", ".codex/auth.json", ".config/gh/hosts.yml", ".docker/config.json", ".kube/config",
    ".npmrc", ".pypirc", ".gem/credentials", ".config/hub"))
SECRET_DIRS = {".aws", ".ssh", ".gnupg"}
_ENV_TEMPLATES = {"example", "sample", "template", "dist"}
_SECRET_SAMPLES = (".env", ".env.local", "server.pem", "server.key", "id_rsa", "id_ed25519", "id_ecdsa", "credentials.json",
                   ".netrc", ".git-credentials")
_READ_TOOLS = {"Read", "Glob", "Grep"}
_PATH_TOOLS = {"Read": "file_path", "Edit": "file_path", "Write": "file_path", "MultiEdit": "file_path",
               "NotebookEdit": "notebook_path"}


def is_secret_name(name: str) -> bool:
    n = name.casefold()
    if n == ".env" or (n.startswith(".env.") and n[5:] not in _ENV_TEMPLATES):
        return True
    if n.endswith((".pem", ".key")) and not n.startswith("."):
        return True
    if n in (".netrc", "_netrc", ".git-credentials", ".pgpass"):
        return True
    return n.startswith(("id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "credentials"))


def _braces(pattern: str) -> list[str]:
    """'*.{env,ts}' -> ['*.env', '*.ts'] (one level, enough for a filename filter)."""
    m = re.search(r"\{([^{}]*)\}", pattern)
    return [pattern[:m.start()] + alt + pattern[m.end():] for alt in m.group(1).split(",")] if m else [pattern]


def glob_may_hit_secret(pattern: str) -> bool:
    """True when a filename glob (Grep's `glob`) could match a secret file such as .env."""
    name = os.path.basename(pattern.rstrip("/")) or pattern
    return any(fnmatch.fnmatchcase(sample, alt.casefold()) for alt in _braces(name.casefold()) for sample in _SECRET_SAMPLES)


def _within(p: str, root: str) -> bool:
    p, root = p.casefold(), root.casefold()  # macOS paths are case-insensitive
    return p == root or p.startswith(root.rstrip(os.sep) + os.sep)


def _resolve(raw: str, base: str) -> str:
    s = re.sub(r"^\$\{?HOME\}?(?=/|$)", str(Path.home()), raw)
    s = os.path.expanduser(s)
    if not os.path.isabs(s):
        s = os.path.join(base, s)
    return os.path.realpath(os.path.normpath(s))


def _repo_label(target: str, root: str) -> str:
    """'acme/api' for a path inside a repo below root, else its top folder."""
    p = Path(target)
    while _within(str(p), root) and not str(p).casefold() == root.casefold():
        if (p / ".git").exists():
            return remote_label(_git_config_remote(p)) or p.name
        p = p.parent
    rel = os.path.relpath(target, root)
    return rel.split(os.sep)[0] if rel != "." else os.path.basename(root)


def strictest(*decisions: dict) -> dict:
    """The strictest of several PreToolUse decisions: deny > ask > the rest."""
    rank = {"deny": 2, "ask": 1}
    return max(decisions, key=lambda d: rank.get(d.get("hookSpecificOutput", {}).get("permissionDecision"), 0),
               default={})


class Fence:
    def __init__(self, session: str, root: Path | None = None, clients: tuple[str, ...] | None = None,
                 vault: Path | None = None, roots: list[Path] | None = None, never: set[str] | None = None,
                 worktrees: dict[str, str] | None = None, isolated: bool | None = None) -> None:
        if roots is None:
            roots = [root] if root is not None else settings.settings.roots()
        self.roots = [os.path.realpath(r) for r in roots]
        self.session = os.path.realpath(session)
        self._worktrees = worktrees  # worktree -> repo; None: the registry, read as it changes
        self.clients = tuple(settings.settings["client_dirs"]) if clients is None else clients
        self.isolated = settings.settings.work if isolated is None else isolated  # every repo is a client folder
        # Folder names the user put on the never-open list (Settings): denied anywhere, like secrets.
        self.never = {n.casefold() for n in (settings.settings["skip_names"] if never is None else never)}
        vault = settings.settings.vault() if vault is None else vault
        # A notes folder outside the roots counts as one more root: its secrets/ is blocked like theirs.
        notes = os.path.realpath(vault) if vault else None
        self.notes_root = notes if notes and not any(_within(notes, r) for r in self.roots) else None
        if self.notes_root:
            self.roots.append(self.notes_root)
        self.hub = bool(vault) and _within(self.session, os.path.realpath(vault))
        self.home = self._canon(self.session)  # the session's repo: for a worktree, the repo it belongs to
        self.root = self._root(self.home) or self.home  # the session's own root (labels, client folders)
        home = Path.home()
        self.sensitive = [*(os.path.join(r, SECRETS_DIR) for r in self.roots), *(str(home / d) for d in sorted(SECRET_DIRS)),
                          *map(str, SECRET_FILES)]

    def in_client(self) -> bool:
        """True when the session works inside one of the client folders (any repo, in the work profile)."""
        if self.isolated:
            return True
        rel = os.path.relpath(self.home, self.root)
        top = rel.split(os.sep)[0].casefold() if rel != "." else ""
        return bool(top) and any(top == c.casefold() for c in self.clients)

    def _canon(self, target: str) -> str:
        """A path inside a registered worktree, as the same path in the worktree's repo."""
        trees = worktree.registered() if self._worktrees is None else self._worktrees
        for wt, repo in trees.items():
            if _within(target, wt):
                rel = os.path.relpath(target, wt)
                return os.path.realpath(repo) if rel == "." else os.path.join(os.path.realpath(repo), rel)
        return target

    def _root(self, target: str) -> str | None:
        """The deepest of the user's roots that holds target."""
        return max((r for r in self.roots if _within(target, r)), key=len, default=None)

    def check_path(self, target: str, write: bool = True) -> tuple[str, str] | None:
        """('deny' | 'ask', reason) for one resolved path, or None. A write to a file that decides what runs
        without a card (settings, hooks, skills, MCP servers) always asks, in any repo and under a grant."""
        verdict = self._check_path(target, write)
        if write and (verdict is None or verdict[0] == "ask") and trust.runs_code(target):
            return "ask", trust.RUNS_CODE if verdict is None else f"{verdict[1]} {trust.RUNS_CODE}"
        return verdict

    def _check_path(self, target: str, write: bool) -> tuple[str, str] | None:
        if is_secret_name(os.path.basename(target)) or SECRET_DIRS & {p.casefold() for p in Path(target).parts} or \
                any(target.casefold() == str(f).casefold() for f in SECRET_FILES):
            return "deny", "Secret files (.env, keys, credentials, ~/.ssh, ~/.aws) are blocked in Orb."
        if hit := next((p for p in Path(target).parts if p.casefold() in self.never), None):
            return "deny", f"{hit}/ is on your never-open list in Orb's settings."
        actual, target = target, self._canon(target)
        if _within(target, os.path.realpath(config.STATE_DIR)):  # its registry decides what the fence trusts
            return "deny", "Orb's own state folder is blocked in Orb."
        root = self._root(target)
        if root is None:
            return None
        rel = os.path.relpath(target, root)
        top = rel.split(os.sep)[0] if rel != "." else ""
        if top and fnmatch.fnmatch(SECRETS_DIR, top.casefold()):  # a glob like "sec*" counts too
            return "deny", "A secrets/ folder holds credentials and is blocked in Orb."
        if _within(actual, self.session) or (self.home == self.session and _within(target, self.home)):
            return None  # its own folder; a repo's session also reaches the repo's worktrees
        if _within(target, self.home):  # a worktree's session reaching the checkout or another worktree
            where = "another delegation's worktree" if actual != target else "the checkout"
            return "ask", f"Outside this worktree: {where} of {_repo_label(target, root).split('/')[-1]}."
        for client in self.clients:
            if top and fnmatch.fnmatch(client.casefold(), top.casefold()) and \
                    not _within(self.home, os.path.join(root, client)):
                if self.hub and not write:
                    return "ask", f"Client repo: {_repo_label(target, root)}."
                if self.hub:
                    return "deny", (f"{client}/ is a client folder: the second-brain session may read it "
                                    "but not change it.")
                return "deny", (f"{client}/ is a client folder; this session works in "
                                f"{os.path.basename(self.home)}. Open {client} as its own session in Orb.")
        here = _repo_label(self.home, self.root).split("/")[-1]  # "api", not "acme/api"
        there = os.path.basename(root) if root == self.notes_root else _repo_label(target, root).split("/")[-1]
        if self.isolated and not (self.hub and not write):
            return "deny", (f"Other repo: {there}. In Orb's work profile a session stays in its own repo "
                            f"({here}); open {there} as its own session in Orb.")
        return "ask", f"Other repo: {there}. This session is in {here}."

    def _paths(self, tool: str, inp: dict[str, Any], base: str) -> list[str]:
        if tool in _PATH_TOOLS:
            raw = inp.get(_PATH_TOOLS[tool])
            return [_resolve(raw, base)] if raw else []
        if tool in ("Glob", "Grep"):
            here = _resolve(inp["path"], base) if inp.get("path") else base
            out = [here]
            if tool == "Glob" and inp.get("pattern"):  # names only, but "../secrets/*" still leaves the repo
                out.append(_resolve(str(inp["pattern"]), here))
            return out
        return []

    def _bash_paths(self, cmd: str) -> list[str]:
        base, out = self.session, []
        for a in shell.read(cmd).args:
            if not (a.path or is_secret_name(os.path.basename(a.value))):
                continue
            target = _resolve(a.value, base)
            out.append(target)
            if shell.GLOB_CHARS.search(a.value):  # what the shell would expand it to
                state = os.path.realpath(config.STATE_DIR)
                out += [m for m in itertools.islice(glob.iglob(target), 500)
                        if is_secret_name(os.path.basename(m)) or _within(os.path.realpath(m), state)]
            if a.cd:
                base = target
        return out

    def rule(self, tool: str, inp: dict[str, Any]) -> dict:
        """PreToolUse decision ({} = no objection)."""
        if tool == "Bash":
            cmd = str(inp.get("command", ""))
            read = shell.read(cmd)
            targets, write, recursive = self._bash_paths(cmd), not read.read_only, read.recursive
        else:
            targets, write = self._paths(tool, inp, self.session), tool not in _READ_TOOLS
            recursive = tool in ("Grep", "Glob")
            if tool == "Grep" and inp.get("glob") and glob_may_hit_secret(str(inp["glob"])):
                return deny("This search would read secret files (.env, keys, credentials); narrow the glob.")
        asked = None
        for t in targets:
            if recursive and any(_within(s, t) for s in self.sensitive):
                return deny(f"{t} holds secrets (a secrets/ folder, ~/.ssh, ~/.aws, ...); search a narrower folder.")
            verdict = self.check_path(t, write)
            if verdict and verdict[0] == "deny":
                return deny(verdict[1])
            if verdict and asked is None:
                asked = verdict[1]
        return ask(asked) if asked else {}

    def reason(self, tool: str, inp: dict[str, Any]) -> str | None:
        """The fence's note for an approval card ("Other repo: … This session is in …"), if any."""
        return self.rule(tool, inp).get("hookSpecificOutput", {}).get("permissionDecisionReason")
