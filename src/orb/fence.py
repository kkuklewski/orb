"""Repo fence: a session works in its own repo and doesn't wander into others.

PreToolUse decision for file tools (Read, Glob, Grep, Edit, Write, ...) and Bash commands:
1. deny, always: secret files (.env, keys, credentials, ~/.ssh, ~/.aws) and any secrets/ folder at the
   top of a root (the folders the user gave Orb in the onboarding).
2. deny: a client folder (settings["client_dirs"]) from a session that wasn't opened inside it.
3. ask: any other repo inside the roots; the card and the spoken prompt say where it goes.
With a notes vault set up, the vault session is the hub: it may read client folders too (with a card),
but never change them; only a Bash command made of plain read-only commands counts as reading.
Paths outside the roots get no objection here (the normal approval flow decides).

Bash commands are read for path-like words, following `cd` / `pushd`. That stops a session that
drifts; it is not proof against a command built to hide a path (variables, base64), and the
approval card stays the last line.
"""

from __future__ import annotations

import fnmatch
import glob
import itertools
import os
import re
import shlex
from pathlib import Path
from typing import Any

from . import settings
from .brain import ask, deny
from .folders import _git_config_remote, remote_label

SECRETS_DIR = "secrets"
SECRET_FILES = (Path.home() / ".claude" / ".credentials.json", Path.home() / ".codex" / "auth.json")
_ENV_TEMPLATES = {"example", "sample", "template", "dist"}
_SECRET_SAMPLES = (".env", ".env.local", "server.pem", "server.key", "id_rsa", "id_ed25519", "credentials.json")
_RECURSIVE = re.compile(r"\b(?:rg|find|fd|ag|tar|zip|rsync|du|tree)\b|\s-[A-Za-z]*[rR]\b|--recursive")
_GLOB_CHARS = re.compile(r"[*?\[]")
_PATH_ARG_FLAGS = {"cd", "pushd", "-C", "--prefix", "--cwd", "--dir", "--directory", "--git-dir", "--work-tree"}
_READ_TOOLS = {"Read", "Glob", "Grep"}
# Read-only Bash for the vault hub: an allowlist of commands and of their flags. Anything not listed
# (a command, a flag, a shell operator, a git global option) counts as a change.
_SHORT_FLAGS = {  # command -> allowed letters in short-flag clusters ("-rn"), plus allowed long flags
    "cat": ("nbsuvetAET", set()),
    "ls": ("1aAdFGhlLRrStT", {"--all", "--color", "--color=never"}),
    "head": ("nc", set()),
    "tail": ("nc", set()),
    "wc": ("lwcm", set()),
    "grep": ("rRnilvcwoEFHhsxqLA BC0123456789e".replace(" ", ""),
             {"--include", "--exclude", "--exclude-dir", "--color", "--line-number", "--ignore-case", "--recursive",
              "--count", "--files-with-matches", "--fixed-strings", "--extended-regexp", "--word-regexp"}),
    "stat": ("fLlsx", set()),
    "echo": ("n", set()),
    "cd": ("", set()), "pushd": ("", set()), "popd": ("", set()), "pwd": ("", set()),
}
_FIND_OK = {"-name", "-iname", "-type", "-maxdepth", "-mindepth", "-path", "-ipath", "-newer", "-mtime", "-size",
            "-not", "-o", "-a", "-or", "-and", "-print", "-empty", "!"}
_READ_ONLY_GIT = {"log", "show", "status", "diff", "rev-parse", "ls-files", "blame", "shortlog", "describe"}
_LISTING_GIT = {"branch", "tag", "remote"}  # read-only only with listing flags and nothing else
_LISTING_FLAGS = {"-a", "-r", "-v", "-vv", "-l", "--list", "--all", "--remotes", "--verbose", "--show-current"}
_GIT_UNSAFE = ("--output", "--output-directory", "--ext-diff", "--textconv")  # git accepts abbreviations too
_OPERATORS = {"&&", "||", ";", "|"}
_PATH_TOOLS = {"Read": "file_path", "Edit": "file_path", "Write": "file_path", "MultiEdit": "file_path",
               "NotebookEdit": "notebook_path"}


def is_secret_name(name: str) -> bool:
    n = name.casefold()
    if n == ".env" or (n.startswith(".env.") and n[5:] not in _ENV_TEMPLATES):
        return True
    if n.endswith((".pem", ".key")) and not n.startswith("."):
        return True
    return n.startswith(("id_rsa", "id_ed25519", "credentials"))


def _flag_ok(cmd: str, tok: str) -> bool:
    letters, longs = _SHORT_FLAGS[cmd]
    if tok.startswith("--"):
        return tok.split("=", 1)[0] in longs
    return re.fullmatch(r"-\d+", tok) is not None or all(c in letters for c in tok[1:])


def _segment_read_only(words: list[str]) -> bool:
    cmd, args = words[0], words[1:]
    if cmd == "git":
        i = 0
        while i < len(args) and args[i].startswith("-"):  # global options: only -C <path> and --no-pager
            if args[i] == "-C" and i + 1 < len(args):
                i += 2
            elif args[i] == "--no-pager":
                i += 1
            else:
                return False
        sub, rest = (args[i], args[i + 1:]) if i < len(args) else ("", [])
        flags = [w for w in rest if w.startswith("-")]
        if sub in _LISTING_GIT:
            return all(w in _LISTING_FLAGS for w in flags) and len(rest) == len(flags)
        if sub not in _READ_ONLY_GIT:
            return False
        return not any(len(name := w.split("=", 1)[0]) > 3 and full.startswith(name) for w in flags for full in _GIT_UNSAFE)
    if cmd == "find":
        return all(w in _FIND_OK for w in args if w.startswith("-") or w == "!")
    if cmd not in _SHORT_FLAGS:
        return False
    return all(_flag_ok(cmd, w) for w in args if w.startswith("-") and w != "-")


def read_only_bash(cmd: str) -> bool:
    """True when every segment is an allowlisted read-only command with allowlisted flags (fails closed)."""
    if re.search(r"[`$(){}<>\\#\r]", cmd):  # "#" would end shlex's view at a newline bash still runs past
        return False
    for raw in re.findall(r"(?:'[^']*'|\"[^\"]*\"|[^\s'\"])+", cmd):
        bare = re.sub(r"'[^']*'|\"[^\"]*\"", "q", raw)  # quoted parts don't expand
        if _GLOB_CHARS.search(bare) and bare[0] in "-*?[":
            return False  # the shell could expand it into a flag, e.g. a file named "-delete" or "--output=x"
    try:
        lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)  # a newline ends a command
        lex.commenters = ""
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return False
    words: list[str] = []
    for tok in tokens + [";"]:
        if re.fullmatch(r"[();<>|&]+", tok):
            if tok not in _OPERATORS or (words and not _segment_read_only(words)):
                return False
            words = []
        else:
            words.append(tok)
    return True


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
                 vault: Path | None = None, roots: list[Path] | None = None, never: set[str] | None = None) -> None:
        if roots is None:
            roots = [root] if root is not None else settings.settings.roots()
        self.roots = [os.path.realpath(r) for r in roots]
        self.session = os.path.realpath(session)
        self.clients = tuple(settings.settings["client_dirs"]) if clients is None else clients
        # Folder names the user put on the never-open list (Settings): denied anywhere, like secrets.
        self.never = {n.casefold() for n in (settings.settings["skip_names"] if never is None else never)}
        vault = settings.settings.vault() if vault is None else vault
        # A notes folder outside the roots counts as one more root: its secrets/ is blocked like theirs.
        notes = os.path.realpath(vault) if vault else None
        self.notes_root = notes if notes and not any(_within(notes, r) for r in self.roots) else None
        if self.notes_root:
            self.roots.append(self.notes_root)
        self.hub = bool(vault) and _within(self.session, os.path.realpath(vault))
        self.root = self._root(self.session) or self.session  # the session's own root (labels, client folders)
        home = Path.home()
        self.sensitive = [*(os.path.join(r, SECRETS_DIR) for r in self.roots), str(home / ".aws"), str(home / ".ssh"),
                          *map(str, SECRET_FILES)]

    def _root(self, target: str) -> str | None:
        """The deepest of the user's roots that holds target."""
        return max((r for r in self.roots if _within(target, r)), key=len, default=None)

    def check_path(self, target: str, write: bool = True) -> tuple[str, str] | None:
        """('deny' | 'ask', reason) for one resolved path, or None."""
        if is_secret_name(os.path.basename(target)) or ".aws" in Path(target).parts or \
                any(target.casefold() == str(f).casefold() for f in SECRET_FILES):
            return "deny", "Secret files (.env, keys, credentials) are blocked in Orb."
        if hit := next((p for p in Path(target).parts if p.casefold() in self.never), None):
            return "deny", f"{hit}/ is on your never-open list in Orb's settings."
        root = self._root(target)
        if root is None:
            return None
        rel = os.path.relpath(target, root)
        top = rel.split(os.sep)[0] if rel != "." else ""
        if top and fnmatch.fnmatch(SECRETS_DIR, top.casefold()):  # a glob like "sec*" counts too
            return "deny", "A secrets/ folder holds credentials and is blocked in Orb."
        if _within(target, self.session):
            return None
        for client in self.clients:
            if top and fnmatch.fnmatch(client.casefold(), top.casefold()) and \
                    not _within(self.session, os.path.join(root, client)):
                if self.hub and not write:
                    return "ask", f"Client repo: {_repo_label(target, root)}."
                if self.hub:
                    return "deny", (f"{client}/ is a client folder: the second-brain session may read it "
                                    "but not change it.")
                return "deny", (f"{client}/ is a client folder; this session works in "
                                f"{os.path.basename(self.session)}. Open {client} as its own session in Orb.")
        here = _repo_label(self.session, self.root).split("/")[-1]  # "api", not "acme/api"
        there = os.path.basename(root) if root == self.notes_root else _repo_label(target, root).split("/")[-1]
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
        try:
            lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
            lex.commenters = ""  # words after a comment still count as paths (fails closed)
            lex.whitespace_split = True
            tokens = list(lex)
        except ValueError:  # unbalanced quotes (e.g. a heredoc with an apostrophe)
            tokens = [t.strip("'\"") for t in cmd.split()]
        base, out, prev = self.session, [], ""
        for tok in tokens:
            if re.fullmatch(r"[();<>|&]+", tok):
                prev = tok
                continue
            value = tok.split("=", 1)[1] if re.match(r"^-{0,2}[\w.-]+=", tok) else tok
            looks_like_path = (
                prev in _PATH_ARG_FLAGS
                or (value.startswith(("/", "~", ".", "$HOME", "${HOME}")) and not re.search(r"\s", value))
                or ("/" in value and "://" not in value and not re.search(r"\s", value))
                or (_GLOB_CHARS.search(value) and not re.search(r"\s", value))
                or is_secret_name(os.path.basename(value))
            )
            if value and looks_like_path:
                target = _resolve(value, base)
                out.append(target)
                if _GLOB_CHARS.search(value):  # what the shell would expand it to
                    out += [m for m in itertools.islice(glob.iglob(target), 500) if is_secret_name(os.path.basename(m))]
                if prev in ("cd", "pushd"):
                    base = target
            prev = tok
        return out

    def rule(self, tool: str, inp: dict[str, Any]) -> dict:
        """PreToolUse decision ({} = no objection)."""
        if tool == "Bash":
            cmd = str(inp.get("command", ""))
            targets, write = self._bash_paths(cmd), not read_only_bash(cmd)
            recursive = bool(_RECURSIVE.search(cmd))
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
