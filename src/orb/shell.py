"""Shell reader: one reading of a Bash command for every rule of the tool gate (ADR 0011).

`read(cmd)` parses a command once (cached by its text) and answers what the gate's rules ask of it:
- `read_only`: every segment is an allowlisted read-only command with allowlisted flags (the vault session reads);
- `args`: every word and whether it looks like a path or follows `cd` / `pushd` (the repo fence);
- `recursive`: it may walk a folder tree (a search near secrets is denied);
- `words`: the plain words, () when anything could chain, expand or redirect (a grant's git and gh commands);
- `heredoc_commit`: Claude Code's `git commit -m "$(cat <<'EOF' … EOF)"` as (flags, body); a body with an EOF line
  of its own could end the heredoc early, so it is not one;
- `push`: "deny" (force), "ask" (anything but a literal plain push) or None; a heredoc commit's body is only text.
Every answer fails closed: quotes, comments, newlines, git global options and globs the shell could turn into flags
make a command not read-only, not plain and not a plain push. It is not proof against a command built to hide what it
does (variables, base64); the approval card stays the last line.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

GLOB_CHARS = re.compile(r"[*?\[]")
_OPERATOR = re.compile(r"[();<>|&]+")
_OPERATORS = {"&&", "||", ";", "|"}
_WALKERS = re.compile(r"\b(?:rg|find|fd|ag|tar|zip|rsync|du|tree)\b")
_FLAG_START = r"(?:^|[\s'\"`(=;&|])"  # a flag starts the text, a word or a quoted string (`bash -c '-r …'`)
_SHORT_GROUP = re.compile(_FLAG_START + r"-([^-\s'\"][^\s'\"]*)")
_LONG_OPTION = re.compile(_FLAG_START + r"--([A-Za-z][\w-]*)")
_RECURSIVE_LONG = ("recursive", "dereference-recursive", "directories")
_RECURSE_ARG = re.compile(_FLAG_START + r"-d\s*['\"]?r")  # grep -d recurse, or any abbreviation of it
_PATH_ARG_FLAGS = {"cd", "pushd", "-C", "--prefix", "--cwd", "--dir", "--directory", "--git-dir", "--work-tree"}
_SHELL = re.compile(r"[;&|<>`$(){}\\\n\r*?\[\]~]")
# `git commit -m "$(cat <<'EOF' … EOF)"`, the way Claude Code writes a commit: a quoted heredoc never expands.
_HEREDOC_COMMIT = re.compile(r"git commit((?: -[A-Za-z-]+)*) -m \"\$\(cat <<'EOF'\n(.*)\nEOF\n\)\"", re.DOTALL)

# Read-only commands: an allowlist of commands and of their flags. Anything not listed (a command, a flag, a shell
# operator, a git global option) counts as a change.
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

# Pushes
_FORCE_RAW = re.compile(r"\bpush\b[^;&|\n]*?(\s--force\b|\s--force-with-lease\b|\s-[A-Za-z]*f[A-Za-z]*\b|\s\+\S)")
_PLAIN_PUSH = re.compile(
    r"^\s*git\s+push(?:\s+(?:-u|--set-upstream|-v|--verbose|-q|--quiet|--tags|--follow-tags|-n|--dry-run))*"
    r"(?:\s+[A-Za-z0-9._/][A-Za-z0-9._/-]*){0,2}\s*$"
)
_CONFIG_TRICKS = re.compile(r"\bgit\s+config\b|\balias\.|\bremote\.|\bGIT_[A-Z_]*=|\s-c\s|--config-env")


@dataclass(frozen=True)
class Arg:
    value: str  # the word (a `--flag=value` word: its value)
    path: bool  # it looks like a path
    cd: bool  # it follows cd / pushd: later relative paths start from it


@dataclass(frozen=True)
class Command:
    text: str
    norm: str  # whitespace runs collapsed (a command with a newline: only stripped)
    read_only: bool
    args: tuple[Arg, ...]
    recursive: bool
    words: tuple[str, ...]
    heredoc_commit: tuple[tuple[str, ...], str] | None
    push: Literal["deny", "ask"] | None


@lru_cache(maxsize=256)
def read(cmd: str) -> Command:
    """The command, read once: the hook and every rule it runs ask the same reading."""
    n = norm(cmd)
    m = _HEREDOC_COMMIT.fullmatch(n.strip())
    commit = (tuple(m.group(1).split()), m.group(2)) if m and "EOF" not in m.group(2).split("\n") else None
    return Command(cmd, n, _read_only(cmd), _args(_lexed(cmd)), _recursive(cmd), _words(n), commit,
                   None if commit else _push(cmd))


def norm(cmd: str) -> str:
    return " ".join(cmd.split()) if "\n" not in cmd.strip() else cmd.strip()


def _tokens(cmd: str) -> list[str]:
    """shlex with shell operators as their own tokens; '#' is a plain character (fails closed). Raises ValueError."""
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lex.commenters = ""
    lex.whitespace_split = True
    return list(lex)


def _lexed(cmd: str) -> list[str]:
    try:
        return _tokens(cmd)
    except ValueError:  # unbalanced quotes (e.g. a heredoc with an apostrophe)
        return [t.strip("'\"") for t in cmd.split()]


def _recursive(cmd: str) -> bool:
    """It may walk a folder tree: a walker command, r / R anywhere in a single-dash flag group ("-rn", "-5r", "-rC2";
    a -r meaning "reverse" only fails closed), any prefix of a recursive long option (getopt takes `--recur`,
    `--dir=rec`) or grep's `-d recurse` (`-d r`). Read from the raw text, so a command inside `bash -c '…'` counts."""
    return bool(_WALKERS.search(cmd)
                or any(re.search(r"[rR]", group) for group in _SHORT_GROUP.findall(cmd))
                or any(full.startswith(name) for name in _LONG_OPTION.findall(cmd) for full in _RECURSIVE_LONG)
                or _RECURSE_ARG.search(cmd))


def _args(tokens: list[str]) -> tuple[Arg, ...]:
    out, prev = [], ""
    for tok in tokens:
        if _OPERATOR.fullmatch(tok):
            prev = tok
            continue
        value = tok.split("=", 1)[1] if re.match(r"^-{0,2}[\w.-]+=", tok) else tok
        path = (
            prev in _PATH_ARG_FLAGS
            or (value.startswith(("/", "~", ".", "$HOME", "${HOME}")) and not re.search(r"\s", value))
            or ("/" in value and "://" not in value and not re.search(r"\s", value))
            or bool(GLOB_CHARS.search(value) and not re.search(r"\s", value))
        )
        if value:
            out.append(Arg(value, path, prev in ("cd", "pushd")))
        prev = tok
    return tuple(out)


def _words(cmd: str) -> tuple[str, ...]:
    """The command's words, or () when it has any shell operator, expansion or redirection."""
    if not cmd or _SHELL.search(re.sub(r"'[^']*'|\"[^\"$`\\]*\"", "q", cmd)):
        return ()
    try:
        return tuple(shlex.split(cmd))
    except ValueError:
        return ()


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


def _read_only(cmd: str) -> bool:
    """True when every segment is an allowlisted read-only command with allowlisted flags (fails closed)."""
    if re.search(r"[`$(){}<>\\#\r]", cmd):  # "#" would end shlex's view at a newline bash still runs past
        return False
    for raw in re.findall(r"(?:'[^']*'|\"[^\"]*\"|[^\s'\"])+", cmd):
        bare = re.sub(r"'[^']*'|\"[^\"]*\"", "q", raw)  # quoted parts don't expand
        if GLOB_CHARS.search(bare) and bare[0] in "-*?[":
            return False  # the shell could expand it into a flag, e.g. a file named "-delete" or "--output=x"
    try:
        tokens = _tokens(cmd.replace("\n", " ; "))  # a newline ends a command
    except ValueError:
        return False
    words: list[str] = []
    for tok in tokens + [";"]:
        if _OPERATOR.fullmatch(tok):
            if tok not in _OPERATORS or (words and not _segment_read_only(words)):
                return False
            words = []
        else:
            words.append(tok)
    return True


def _push(cmd: str) -> Literal["deny", "ask"] | None:
    """'deny' (force), 'ask' (anything but a literal plain push) or None.

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
