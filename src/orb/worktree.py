"""The git side of a delegation (ADR 0004): worktree, push, Apply, revert and Discard.

- `create` snapshots the owner's checkout, uncommitted and untracked (not ignored) files included, through a
  throwaway index, so their working tree and index stay byte-identical. A clean checkout is used as it is;
  otherwise the snapshot is one commit on top of HEAD. The delegation branch starts there, in a worktree
  under Orb's state folder, registered in `worktrees.json` so the repo fence treats it as part of its repo.
  Untracked secret files (.env, keys) and never-open names stay out of the snapshot.
- `apply` lands the delegation's own work (snapshot..branch) on the checkout's current branch: one squash
  commit or a merge commit, per repo. The result is computed with `git merge-tree` before anything moves,
  then the branch fast-forwards to it; a conflict touches nothing and raises `Conflict`.
- `collide` and `push` are the only calls that contact a remote. `collide` fetches the target branch (a read) and
  merges the checked commit against its tip in memory: who landed first in the files that conflict.
  `push` sends the delegation branch to the remote `remote_of` names (the checkout branch's upstream, else origin),
  never forced. The caller pushes only after the owner's Allow or the
  repo's outward steps setting, and never a branch that starts from a snapshot (`from_snapshot`): that commit holds
  the owner's uncommitted work.
- `revert` undoes an applied commit the same way. `remove` drops the worktree and the branch (Discard, and
  the cleanup after Apply) and returns what it could not remove.
Repo hooks and fsmonitor are off for every git call here. Filters and merge drivers come from git config, so
`create` records a fingerprint of the config the checkout sees and `apply` refuses when it changed meanwhile: a
delegated session can't plant a driver that Apply would then run in the owner's checkout.
The registry is trusted only for worktrees under Orb's own worktrees folder that git itself links to the repo.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from . import config

_SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
_ORB = {"GIT_AUTHOR_NAME": "Orb", "GIT_AUTHOR_EMAIL": "orb@localhost",
        "GIT_COMMITTER_NAME": "Orb", "GIT_COMMITTER_EMAIL": "orb@localhost"}
MODES = ("squash", "merge")
CAP = 5  # conflicting files a collision names one by one


class WorktreeError(Exception):
    """A git step refused; the message says why, in plain words."""


class Moved(WorktreeError):
    """The branch has commits its check didn't see."""


class Conflict(WorktreeError):
    def __init__(self, files: list[str]) -> None:
        super().__init__("Conflict in " + ", ".join(files) + ". Nothing was merged." if files else
                         "Conflict. Nothing was merged.")
        self.files = files


@dataclass
class Worktree:
    repo: str  # the owner's checkout (resolved top level)
    path: str  # the worktree (resolved)
    branch: str
    base: str  # the commit the branch started from: HEAD, or the snapshot on top of it
    config: str = ""  # fingerprint of the git config the checkout saw at create (Apply refuses on a change)


# -- the registry -------------------------------------------------------------------------------

def _registry_path() -> Path:
    return config.STATE_DIR / "worktrees.json"


_cache: tuple[str, float, dict[str, dict]] | None = None


def _load() -> dict[str, dict]:
    global _cache
    path = _registry_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    if _cache and _cache[0] == str(path) and _cache[1] == mtime:
        return _cache[2]
    data = (config.read_state(path) or {}).get("worktrees", {})
    _cache = (str(path), mtime, data)
    return data


def _save(data: dict[str, dict]) -> None:
    path = _registry_path()
    config.write_private(path, json.dumps({"version": 1, "worktrees": data}, indent=2))


def _linked(path: str, repo: str) -> bool:
    """True when `path` is under Orb's worktrees folder and its .git file points into `repo`'s own .git."""
    home = os.path.realpath(config.STATE_DIR / "worktrees")
    if os.path.dirname(os.path.realpath(path)) != home:
        return False
    try:
        line = Path(path, ".git").read_text().strip()
    except OSError:
        return False
    gitdir = os.path.realpath(os.path.join(path, line.removeprefix("gitdir:").strip()))
    return line.startswith("gitdir:") and \
        os.path.dirname(gitdir) == os.path.join(os.path.realpath(repo), ".git", "worktrees")


def registered() -> dict[str, str]:
    """Registered worktree -> the repo it belongs to (what the fence reads); entries git doesn't confirm are ignored."""
    return {p: w["repo"] for p, w in _load().items() if isinstance(w, dict) and _linked(p, str(w.get("repo", "")))}


def get(path: str) -> Worktree | None:
    path = os.path.realpath(path)
    w = _load().get(path)
    return Worktree(path=path, **w) if w and _linked(path, w["repo"]) else None


# -- git ----------------------------------------------------------------------------------------

def _git(cwd: str, *args: str, env: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess:
    full = {**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})}
    for k in ("GIT_DIR", "GIT_WORK_TREE"):
        full.pop(k, None)
    out = subprocess.run(["git", "-C", cwd, *_SAFE, *args], capture_output=True, text=True, env=full, timeout=120)
    if check and out.returncode != 0:
        last = (out.stderr or out.stdout).strip().splitlines()[-1:] or [""]
        raise WorktreeError(f"git {args[0]} failed: {last[0]}"[:300])
    return out


def _line(cwd: str, *args: str) -> str:
    return _git(cwd, *args).stdout.strip()


def _config_print(repo: str) -> str:
    """Every config entry git applies in `repo` (system, global, local, includes); the -c overrides above aside."""
    out = _git(repo, "config", "--list", "--show-scope", check=False).stdout
    return hashlib.sha256("\n".join(sorted(l for l in out.splitlines() if not l.startswith("command\t"))).encode()).hexdigest()


def _branch_exists(repo: str, branch: str) -> bool:
    return _git(repo, "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False).returncode == 0


def toplevel(path: str) -> str:
    """The repo `path` is in (resolved); WorktreeError when it is not a git repo."""
    out = _git(path, "rev-parse", "--show-toplevel", check=False)
    if out.returncode != 0:
        raise WorktreeError(f"{Path(path).name} is not a git repo.")
    return os.path.realpath(out.stdout.strip())


def current_branch(repo: str) -> str:
    out = _git(repo, "symbolic-ref", "-q", "--short", "HEAD", check=False)
    if out.returncode != 0:
        raise WorktreeError("The checkout is not on a branch (detached HEAD).")
    return out.stdout.strip()


def branch_name(task: int | str, title: str) -> str:
    """'orb/762-worktree-apply-and-discard' for task #762."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")[:40].rstrip("-")
    return f"orb/{task}-{slug}" if slug else f"orb/{task}"


# -- create -------------------------------------------------------------------------------------

def _snapshot(repo: str, branch: str, never: set[str]) -> str:
    """The commit the delegation starts from: HEAD, or HEAD plus the uncommitted changes."""
    from .fence import is_secret_name

    head = _line(repo, "rev-parse", "--verify", "HEAD^{commit}")
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": os.path.join(tmp, "index")}  # the owner's index is never written
        _git(repo, "read-tree", "HEAD", env=env)
        _git(repo, "add", "-A", env=env)
        added = _git(repo, "diff", "--cached", "--name-only", "-z", "--diff-filter=A", "HEAD", env=env).stdout
        drop = [f for f in added.split("\0") if f and (is_secret_name(os.path.basename(f)) or
                                                      any(p.casefold() in never for p in Path(f).parts))]
        if drop:
            _git(repo, "rm", "--cached", "-q", "--", *drop, env=env)
        tree = _git(repo, "write-tree", env=env).stdout.strip()
    if tree == _line(repo, "rev-parse", "HEAD^{tree}"):
        return head
    return _git(repo, "commit-tree", tree, "-p", head, "-m",
                f"Orb snapshot: uncommitted changes when {branch} was delegated", env=_ORB).stdout.strip()


def create(repo: str, branch: str, dest: str | None = None, never: set[str] | None = None) -> Worktree:
    """A worktree on a new branch from a snapshot of `repo`'s checkout; the checkout itself is not touched."""
    repo = os.path.realpath(_line(repo, "rev-parse", "--show-toplevel"))
    if _git(repo, "check-ref-format", "--branch", branch, check=False).returncode != 0:
        raise WorktreeError(f"{branch} is not a valid branch name.")
    if _branch_exists(repo, branch):
        raise WorktreeError(f"Branch {branch} already exists.")
    path = dest or str(config.STATE_DIR / "worktrees" / f"{Path(repo).name}-{branch.replace('/', '-')}")
    if os.path.exists(path):
        raise WorktreeError(f"{path} already exists.")
    base = _snapshot(repo, branch, {n.casefold() for n in (never or ())})
    Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    _git(repo, "worktree", "add", "-q", "-b", branch, path, base)
    wt = Worktree(repo, os.path.realpath(path), branch, base, _config_print(repo))
    data = dict(_load())
    data[wt.path] = {k: v for k, v in asdict(wt).items() if k != "path"}
    _save(data)
    return wt


# -- review -------------------------------------------------------------------------------------

DIFF_MAX = 200_000


def tip(wt: Worktree) -> str:
    return _line(wt.repo, "rev-parse", f"refs/heads/{wt.branch}")


def ahead(wt: Worktree) -> int:
    """Commits on the delegation branch since it started."""
    return int(_line(wt.repo, "rev-list", "--count", f"{wt.base}..refs/heads/{wt.branch}"))


# What a test or build run leaves behind in a repo that doesn't ignore it: not the delegation's work.
CACHES = ("__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".coverage", "coverage", "node_modules",
          ".next", ".turbo", ".cache")
_NOT_WORK = [f":(exclude,glob)**/{n}{tail}" for n in CACHES for tail in ("", "/**")] + [":(exclude,glob)**/*.pyc"]


def dirty(wt: Worktree) -> bool:
    """Uncommitted changes in the worktree (they would not be applied); test and build caches don't count."""
    return bool(_git(wt.path, "status", "--porcelain", "--untracked-files=all", "--", ".", *_NOT_WORK).stdout.strip())


def diff(wt: Worktree) -> str:
    """The delegation's own work (snapshot..branch): stat, then the patch, capped. No external diff or textconv
    drivers: those come from git config and would run code."""
    rng = f"{wt.base}..refs/heads/{wt.branch}"
    flags = ["--no-color", "--no-ext-diff", "--no-textconv"]
    out = _git(wt.repo, "diff", *flags, "--stat", rng).stdout + "\n" + _git(wt.repo, "diff", *flags, rng).stdout
    return out if len(out) <= DIFF_MAX else out[:DIFF_MAX] + "\n… (cut: the diff is longer)"


# -- push --------------------------------------------------------------------------------------

def remote_of(repo: str) -> tuple[str, str] | None:
    """Where a delegation's branch goes and its PR merges into: (remote, branch). The checkout branch's upstream,
    else origin and the checkout's branch; None when there is no remote."""
    cur = current_branch(repo)
    remote = _git(repo, "config", "--get", f"branch.{cur}.remote", check=False).stdout.strip()
    merge = _git(repo, "config", "--get", f"branch.{cur}.merge", check=False).stdout.strip()
    if remote and remote != "." and merge.startswith("refs/heads/"):
        return remote, merge.removeprefix("refs/heads/")
    return ("origin", cur) if "origin" in _git(repo, "remote", check=False).stdout.split() else None


def from_snapshot(wt: Worktree) -> bool:
    """The branch starts from Orb's snapshot of uncommitted changes (pushing it would publish them)."""
    head = _git(wt.repo, "log", "-1", "--format=%an%x00%s", wt.base, check=False).stdout
    return head.startswith("Orb\0Orb snapshot:")


def unpushed(wt: Worktree, remote: str, into: str) -> int:
    """The owner's own commits under the branch that `remote`/`into` doesn't have yet (they would go along)."""
    out = _git(wt.repo, "rev-list", "--count", f"{wt.base}", f"^refs/remotes/{remote}/{into}", check=False)
    return int(out.stdout.strip() or 0) if out.returncode == 0 else 0


def _same_config(wt: Worktree) -> None:
    """Refuse when the git config changed since the delegation started: a remote's URL, ssh command, filter or merge
    driver could run code or send the work elsewhere."""
    if not wt.config or _config_print(wt.repo) != wt.config:
        raise WorktreeError(f"The git config changed since {wt.branch} was delegated (a filter or merge driver "
                            "could run code). Check git config --list --show-origin, then apply by hand.")


# Never the transport that runs a local command (ext::), whatever the config says.
_NET = ["-c", "protocol.ext.allow=never"]


def _fetch(wt: Worktree, remote: str, into: str) -> str:
    _same_config(wt)
    theirs = f"refs/remotes/{remote}/{into}"
    _git(wt.repo, *_NET, "fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{into}:{theirs}")
    return theirs


def collide(wt: Worktree, remote: str, into: str, commit: str) -> dict:
    """Fetch `into` from `remote` and merge `commit` against its tip in memory (nothing is written): `behind` = commits
    the remote target has that the branch lacks, `files` = paths that conflict, `landed` = per file (first CAP) the
    newest commit that reached the remote first: author, whether it is the repo's own user.email, when, subject."""
    theirs = _fetch(wt, remote, into)
    behind = int(_line(wt.repo, "rev-list", "--count", f"{commit}..{theirs}"))
    out = _git(wt.repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", theirs, commit, check=False)
    if out.returncode not in (0, 1):
        raise WorktreeError(f"git merge-tree failed: {out.stderr.strip()[:200]}")
    files = sorted({f for f in out.stdout.splitlines()[1:] if f}) if out.returncode == 1 else []
    me = _git(wt.repo, "config", "user.email", check=False).stdout.strip().lower()
    base = _line(wt.repo, "merge-base", theirs, commit) if files else ""
    landed = []
    for f in files[:CAP]:
        if said := _line(wt.repo, "log", "-1", "--format=%an%x00%ae%x00%ct%x00%s", f"{base}..{theirs}", "--", f):
            name, email, when, subject = said.split("\0", 3)
            landed.append({"file": f, "author": name, "mine": bool(me) and email.lower() == me, "when": int(when),
                           "subject": subject})
    return {"behind": behind, "files": files, "landed": landed}


def push(wt: Worktree, remote: str, commit: str) -> None:
    """`commit` (the one the check ran on) as the delegation branch on `remote`; no force, hooks off."""
    if tip(wt) != commit:
        raise Moved(f"{wt.branch} changed after its check; re-run the check.")
    _same_config(wt)
    ref = f"refs/heads/{wt.branch}"
    _git(wt.repo, *_NET, "push", "--quiet", remote, f"{commit}:{ref}")


# -- update from the target branch (#869) -------------------------------------------------------

def merge_in(wt: Worktree, remote: str, into: str, message: str) -> dict:
    """Start merging the fresh `remote`/`into` into the delegation branch in its worktree, uncommitted (conflicts stay
    as markers for the session). Never a rebase. Returns {head: the branch before, theirs, base: their merge base}."""
    if dirty(wt):
        raise WorktreeError(f"Uncommitted changes on branch {wt.branch}.")
    theirs = _line(wt.repo, "rev-parse", _fetch(wt, remote, into))
    head = _line(wt.path, "rev-parse", "HEAD")
    out = _git(wt.path, "merge", "--no-commit", "--no-ff", "-m", message, theirs, check=False)
    if not merging(wt):  # a conflict exits 1 and leaves the merge open; anything else started nothing
        raise WorktreeError(f"git merge failed: {' '.join((out.stderr or out.stdout).split())[:200]}")
    return {"head": head, "theirs": theirs, "base": _line(wt.repo, "merge-base", head, theirs)}


def merging(wt: Worktree) -> bool:
    return _git(wt.path, "rev-parse", "-q", "--verify", "MERGE_HEAD", check=False).returncode == 0


def _added(wt: Worktree, base: str, theirs: str) -> dict[str, list[str]]:
    """Per file, the lines the other side added since base (text files; a deleted file has none)."""
    out = _git(wt.repo, "-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv",
               "--unified=0", base, theirs).stdout
    added: dict[str, list[str]] = {}
    path, head = None, True
    for l in out.splitlines():
        if l.startswith("diff --git "):
            path, head = None, True
        elif head and l.startswith("+++ "):
            path = l[6:] if l.startswith("+++ b/") else None
        elif l.startswith("@@"):
            head = False
        elif not head and path and l.startswith("+"):
            added.setdefault(path, []).append(l[1:])
    return added


def kept(wt: Worktree, update: dict) -> list[str] | None:
    """After the session's update turn: None when the branch has a new commit that contains theirs and every line
    they added since base; else the files that lost lines ([] when there is no such merge at all). An open merge is
    aborted (nothing of it is kept)."""
    if merging(wt):
        _git(wt.path, "merge", "--abort", check=False)
        return []
    now = tip(wt)
    if now == update["head"] or _git(wt.repo, "merge-base", "--is-ancestor", update["theirs"], now, check=False).returncode:
        return []
    gone = []
    for f, lines in _added(wt, update["base"], update["theirs"]).items():
        have = _git(wt.repo, "show", f"{now}:{f}", check=False)
        left = set(have.stdout.splitlines()) if have.returncode == 0 else set()
        if any(l not in left for l in lines):
            gone.append(f)
    return gone or None


# -- apply and revert ---------------------------------------------------------------------------

def _land(repo: str, base: str, ours: str, theirs: str, parents: list[str], message: str) -> str:
    """Merge theirs into ours (from base) without touching anything, then fast-forward the checkout to it."""
    out = _git(repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", f"--merge-base={base}",
               ours, theirs, check=False)
    lines = out.stdout.splitlines()
    if out.returncode == 1:
        raise Conflict(sorted({f for f in lines[1:] if f}))
    if out.returncode != 0 or not lines:
        raise WorktreeError(f"git merge-tree failed: {out.stderr.strip()[:200]}")
    args = [a for p in parents for a in ("-p", p)]
    commit = _git(repo, "commit-tree", lines[0], *args, "-m", message).stdout.strip()
    ff = _git(repo, "merge", "--ff-only", "-q", commit, check=False)
    if ff.returncode != 0:  # e.g. uncommitted changes in a file it touches: --ff-only moved nothing
        raise WorktreeError("Nothing changed: " + " ".join(ff.stderr.split())[:300])
    return commit


def apply(wt: Worktree, mode: str = "squash", message: str | None = None, expect: str | None = None) -> str:
    """Land the delegation's work on the checkout's current branch; returns the new commit. With `expect`, only
    when the branch is still that commit (the one its check ran on)."""
    if mode not in MODES:
        raise WorktreeError(f"Unknown apply mode {mode}: use squash or merge.")
    _same_config(wt)
    current = current_branch(wt.repo)
    if current == wt.branch:
        raise WorktreeError(f"The checkout is on {wt.branch} itself; switch back to your branch first.")
    head = _line(wt.repo, "rev-parse", "HEAD")
    tip = _line(wt.repo, "rev-parse", f"refs/heads/{wt.branch}")
    if tip == wt.base:
        raise WorktreeError(f"{wt.branch} has no commits to apply.")
    if expect is not None and tip != expect:
        raise Moved(f"{wt.branch} changed after its check.")
    if mode == "squash":
        return _land(wt.repo, wt.base, head, tip, [head], message or f"Apply {wt.branch}")
    return _land(wt.repo, wt.base, head, tip, [head, tip], message or f"Merge branch '{wt.branch}' into {current}")


def revert(repo: str, commit: str) -> str:
    """Undo an applied commit with a new commit on the checkout's branch; returns it."""
    repo = os.path.realpath(_line(repo, "rev-parse", "--show-toplevel"))
    current_branch(repo)
    head = _line(repo, "rev-parse", "HEAD")
    commit = _line(repo, "rev-parse", "--verify", f"{commit}^{{commit}}")
    if _git(repo, "merge-base", "--is-ancestor", commit, head, check=False).returncode != 0:
        raise WorktreeError(f"{commit[:12]} is not on the current branch.")
    parent = _line(repo, "rev-parse", f"{commit}^1")
    subject = _line(repo, "log", "-1", "--format=%s", commit)
    return _land(repo, commit, head, parent, [head], f'Revert "{subject}"\n\nThis reverts commit {commit}.')


# -- remove -------------------------------------------------------------------------------------

def remove(wt: Worktree) -> list[str]:
    """Drop the worktree and its branch (Discard, and the cleanup after Apply); returns the leftovers."""
    _git(wt.repo, "worktree", "remove", "--force", "--force", wt.path, check=False)
    _git(wt.repo, "worktree", "prune", check=False)
    _git(wt.repo, "branch", "-D", wt.branch, check=False)
    data = dict(_load())
    data.pop(wt.path, None)
    _save(data)
    leftovers = [wt.path] if os.path.exists(wt.path) else []
    if _branch_exists(wt.repo, wt.branch):
        leftovers.append(f"branch {wt.branch}")
    return leftovers
