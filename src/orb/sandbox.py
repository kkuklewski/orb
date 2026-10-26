"""The sandbox a delegation's declared test and build commands run in (macOS `sandbox-exec`).

A grant lets the declared commands run without a card, and Orb runs the test itself after each turn; both run
files the session edited (`package.json` scripts, `conftest.py`). So they run in a sandbox: writes only in the
worktree and the temp folders, no reads in the home folder except the toolchains (and the owner's
`sandbox_read` folders) and the repo's git folder, no keychain, no ssh agent or Docker socket, and an
environment with only the basic variables (no Orb, tracker, proxy or token variables). Network stays on
(installs and tests need it); the worktree holds nothing secret. Without `sandbox-exec` nothing is covered.
"""

from __future__ import annotations

import hashlib
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

SANDBOX_EXEC = "/usr/bin/sandbox-exec"
# Read-only in the home folder: where this machine's runtimes and package managers live.
TOOLCHAINS = (".local/bin", ".local/share/uv", ".local/share/pnpm", ".nvm", ".bun", ".volta", ".cargo", ".rustup",
              ".pyenv", ".rbenv", ".asdf", ".deno", "miniconda3", "miniforge3", "go", ".gitconfig", ".config/git")
# Never readable, whatever PATH says: credentials and Orb's own state.
NEVER = {".ssh", ".aws", ".gnupg", ".orb", ".claude", ".claude.json", ".config", ".docker", ".kube", ".netrc",
         "library", "documents", "desktop", "downloads"}
ENV_KEEP = ("PATH", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "NVM_DIR", "NVM_BIN")

_PROFILE = """(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath (param "WT")) (subpath (param "CACHE")) (subpath "/private/tmp")
  (subpath "/private/var/folders") (regex #"^/dev/"))
(deny file-read-data (subpath (param "HOME")))
(allow file-read-data (subpath (param "WT")) (subpath (param "GITDIR")) {reads})
(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd"))
(deny network-outbound (remote unix-socket (subpath (param "HOME")))
  (remote unix-socket (regex #"^/private/(tmp|var/run)/com\\.apple\\.launchd\\."))
  (remote unix-socket (literal "/private/var/run/docker.sock")))
"""


def available() -> bool:
    return sys.platform == "darwin" and os.access(SANDBOX_EXEC, os.X_OK)


def cache_dir(worktree: str) -> str:
    """The worktree's package caches (uv, npm, pip): outside the worktree, so `git add -A` never picks them up."""
    tag = hashlib.sha256(os.path.realpath(worktree).encode()).hexdigest()[:16]
    return os.path.join(os.path.realpath(tempfile.gettempdir()), "orb-sandbox", tag)


def _git_dir(worktree: str) -> str:
    """The repo's git folder a worktree reads its objects from (read-only in the sandbox)."""
    try:
        out = subprocess.run(["git", "-C", worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return os.path.realpath(out.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.join(os.path.realpath(worktree), ".git")


def env(worktree: str) -> dict[str, str]:
    """The environment a sandboxed command gets: the basics, its own caches and temp folder."""
    cache = cache_dir(worktree)
    base = {k: os.environ[k] for k in ENV_KEEP if k in os.environ}
    return {**base, "HOME": str(Path.home()), "TMPDIR": os.path.join(cache, "tmp"), "CI": "1",
            "UV_CACHE_DIR": os.path.join(cache, "uv"), "npm_config_cache": os.path.join(cache, "npm"),
            "PIP_CACHE_DIR": os.path.join(cache, "pip"), "XDG_CACHE_HOME": cache}


def _readable(path: str, home: str, depth: int = 1) -> bool:
    rel = Path(os.path.relpath(path, home)).parts
    return len(rel) >= depth and rel[0] != ".." and rel[0].casefold() not in NEVER


def path_reads(home: str) -> list[str]:
    """The PATH folders in the home folder, and the install folders their programs link into (a `node` in
    ~/.local/bin that is a link to ~/.acme/node/bin/node makes ~/.acme/node readable)."""
    out: list[str] = []
    for d in os.environ.get("PATH", "").split(os.pathsep):
        d = os.path.realpath(os.path.expanduser(d)) if d else ""
        if not d or not _readable(d, home) or d in out:
            continue
        out.append(d)
        try:
            links = [e.path for e in os.scandir(d) if e.is_symlink()]
        except OSError:
            continue
        for link in links:
            root = os.path.dirname(os.path.dirname(os.path.realpath(link)))  # <root>/bin/<program>
            if _readable(root, home, depth=2) and root not in out:
                out.append(root)
    return out


def argv(worktree: str, extra_reads: list[str] | tuple[str, ...] = ()) -> list[str]:
    """`sandbox-exec -p <profile> -D …` for the worktree; append the command to run."""
    home, wt = os.path.realpath(Path.home()), os.path.realpath(worktree)
    reads = [os.path.join(home, t) for t in TOOLCHAINS] + path_reads(home)
    reads += [os.path.realpath(os.path.expanduser(p)) for p in extra_reads]
    params = {"WT": wt, "HOME": home, "GITDIR": _git_dir(wt), "CACHE": cache_dir(wt)}
    for i, p in enumerate(reads):
        params[f"R{i}"] = p
    profile = _PROFILE.format(reads=" ".join(f'(subpath (param "R{i}"))' for i in range(len(reads))))
    return [SANDBOX_EXEC, "-p", profile, *(a for k, v in params.items() for a in ("-D", f"{k}={v}"))]


def prepare(worktree: str) -> None:
    os.makedirs(os.path.join(cache_dir(worktree), "tmp"), mode=0o700, exist_ok=True)


def owner_reads() -> list[str]:
    from .settings import settings
    return [p for p in settings["sandbox_read"] if isinstance(p, str) and os.path.isabs(os.path.expanduser(p))]


def wrap(worktree: str, cmd: str, extra_reads: list[str] | tuple[str, ...] | None = None) -> str:
    """A shell command that runs `cmd` in the sandbox, with only the sandbox's environment."""
    extra_reads = owner_reads() if extra_reads is None else extra_reads
    prepare(worktree)
    pairs = [f"{k}={v}" for k, v in env(worktree).items()]
    return shlex.join(["/usr/bin/env", "-i", *pairs, *argv(worktree, extra_reads), "/bin/bash", "--noprofile", "--norc", "-c", cmd])
