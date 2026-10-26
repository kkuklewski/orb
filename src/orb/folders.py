"""Find the git repos under the folders the user gave Orb (its roots) and label them by their remote."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

# Never listed or entered. secrets/ holds credentials and must not even be opened. The user adds
# their own names in Settings (settings["skip_names"]).
SKIP_NAMES = {"secrets", "node_modules", ".venv", "venv", "__pycache__", ".git", ".next", "dist", "build", ".cache"}


def skip_names() -> set[str]:
    from .settings import settings
    return SKIP_NAMES | set(settings["skip_names"])


def inside(root: str | os.PathLike, path: str | os.PathLike) -> bool:
    """True when path, links followed, is root or under it (a note that links out of the vault is not read)."""
    r, p = os.path.realpath(root), os.path.realpath(path)
    return p == r or p.startswith(r.rstrip(os.sep) + os.sep)


MAX_DEPTH = 5


@dataclass
class Folder:
    path: str
    label: str  # "<owner>/<name>" from the remote, else the folder name
    rel: str  # path relative to the scan root
    remote: str | None = None
    branch: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def root_of(path: Path, roots: list[Path]) -> Path | None:
    """The root (from the user's list) that holds path, the deepest one if they nest."""
    p = path.resolve()
    inside = [r.resolve() for r in roots if p == r.resolve() or r.resolve() in p.parents]
    return max(inside, key=lambda r: len(r.parts), default=None)


def is_forbidden(path: Path, root: Path) -> bool:
    """True when path is inside a skipped folder (e.g. secrets/) below root."""
    try:
        parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    skip = skip_names()
    return any(p in skip for p in parts)


def _git_config_remote(repo: Path) -> str | None:
    """origin's URL read from .git/config, without running git."""
    git = repo / ".git"
    if git.is_file():  # worktree or submodule: "gitdir: <path>"
        m = re.match(r"gitdir:\s*(.+)", git.read_text())
        if not m:
            return None
        git = (repo / m.group(1).strip()).resolve()
    try:
        text = (git / "config").read_text()
    except OSError:
        return None
    m = re.search(r'\[remote "origin"\][^\[]*?url\s*=\s*(\S+)', text, re.S)
    if not m:
        m = re.search(r'\[remote "[^"]+"\][^\[]*?url\s*=\s*(\S+)', text, re.S)
    return m.group(1) if m else None


def remote_label(url: str | None) -> str | None:
    """'git@github.com:acme/api.git' -> 'acme/api'."""
    if not url:
        return None
    m = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else None


def git_branch(repo: Path) -> str | None:
    head = repo / ".git" / "HEAD"
    try:
        text = head.read_text().strip()
    except OSError:
        try:
            out = subprocess.run(["git", "-C", str(repo), "branch", "--show-current"],
                                 capture_output=True, text=True, timeout=3)
            return out.stdout.strip() or None
        except (OSError, subprocess.TimeoutExpired):
            return None
    return text.removeprefix("ref: refs/heads/") if text.startswith("ref:") else text[:8]


def describe(path: Path, root: Path) -> Folder:
    url = _git_config_remote(path) if (path / ".git").exists() else None
    try:
        rel = str(path.relative_to(root))
    except ValueError:
        rel = str(path).replace(str(Path.home()), "~", 1)
    if rel == ".":  # the root is a repo itself
        rel = path.name
    return Folder(path=str(path), label=remote_label(url) or path.name, rel=rel,
                  remote=url, branch=git_branch(path) if url or (path / ".git").exists() else None)


def discover(root: Path, max_depth: int = MAX_DEPTH) -> list[Folder]:
    """Every git repo in root (root itself too) and below, skipping skip_names() without entering them."""
    found: list[Folder] = []
    root = root.resolve()
    skip = skip_names()

    def walk(d: Path, depth: int) -> None:
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        names = {e.name for e in entries}
        if ".git" in names:
            found.append(describe(d, root))
        if depth >= max_depth:
            return
        for e in entries:
            if e.name in skip or e.name.startswith(".") or not e.is_dir(follow_symlinks=False):
                continue
            walk(Path(e.path), depth + 1)

    walk(root, 0)
    found.sort(key=lambda f: f.rel.lower())
    return found
