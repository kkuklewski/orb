"""Worktree, Apply, revert and Discard against throwaway repos (never the owner's checkout)."""

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

from orb import config
from orb import worktree as wts
from orb.fence import Fence

ID = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t",
      "GIT_COMMITTER_EMAIL": "t@example.com"}


def git(cwd, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True,
                         env={**os.environ, **ID})
    return out.stdout.strip()


def commit(cwd, files: dict[str, str], msg: str) -> str:
    for name, text in files.items():
        (Path(cwd) / name).parent.mkdir(parents=True, exist_ok=True)
        (Path(cwd) / name).write_text(text)
    git(cwd, "add", "-A")
    git(cwd, "commit", "-q", "-m", msg)
    return git(cwd, "rev-parse", "HEAD")


def fingerprint(repo: Path) -> dict:
    """Every file in the checkout (bytes), the index, HEAD and the status: what 'untouched' means."""
    files = {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(repo.rglob("*")) if p.is_file() and ".git" not in p.relative_to(repo).parts}
    return {"files": files, "index": hashlib.sha256((repo / ".git" / "index").read_bytes()).hexdigest(),
            "head": git(repo, "rev-parse", "HEAD"), "branch": git(repo, "branch", "--show-current"),
            "status": git(repo, "status", "--porcelain=v1", "--untracked-files=all")}


@pytest.fixture
def dev(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STATE_DIR", tmp_path / "state")
    origin = tmp_path / "origin.git"
    git(tmp_path, "init", "-q", "--bare", str(origin))
    for name in ("web", "acme/portal"):
        repo = tmp_path / name
        repo.mkdir(parents=True)
        git(repo, "init", "-q", "-b", "main")
        git(repo, "config", "user.name", "t")
        git(repo, "config", "user.email", "t@example.com")
        commit(repo, {"a.txt": "a\n", "b.txt": "b\n", "c.txt": "one\ntwo\nthree\n", ".gitignore": "dist/\n"}, "init")
    git(tmp_path / "web", "remote", "add", "origin", str(origin))
    git(tmp_path / "web", "push", "-q", "origin", "main")
    return tmp_path


def remote(dev: Path) -> str:
    return git(dev / "web", "ls-remote", "origin")


def test_create_snapshots_uncommitted_work_and_leaves_the_checkout_byte_identical(dev):
    web = dev / "web"
    (web / "a.txt").write_text("a, edited\n")  # modified
    (web / "b.txt").write_text("b, staged\n")
    git(web, "add", "b.txt")  # staged
    (web / "new.txt").write_text("new\n")  # untracked
    (web / ".env").write_text("TOKEN=x\n")  # untracked secret
    (web / "drafts").mkdir()
    (web / "drafts" / "p.txt").write_text("p\n")  # a never-open name
    (web / "dist").mkdir()
    (web / "dist" / "out.js").write_text("built\n")  # ignored
    hook = web / ".git" / "hooks" / "post-checkout"
    hook.write_text(f"#!/bin/sh\ntouch {dev / 'hook-ran'}\n")
    hook.chmod(0o755)
    before, pushed = fingerprint(web), remote(dev)

    wt = wts.create(str(web), "orb/762-fix", never={"drafts"})

    assert fingerprint(web) == before
    tree = Path(wt.path)
    assert (tree / "a.txt").read_text() == "a, edited\n" and (tree / "b.txt").read_text() == "b, staged\n"
    assert (tree / "new.txt").read_text() == "new\n"
    assert not (tree / ".env").exists() and not (tree / "drafts").exists() and not (tree / "dist").exists()
    assert git(tree, "branch", "--show-current") == "orb/762-fix"
    assert git(web, "rev-parse", f"{wt.base}^") == before["head"]  # one snapshot commit on top of HEAD
    assert git(tree, "status", "--porcelain") == ""
    assert wts.registered() == {wt.path: str(web.resolve())} and wts.get(wt.path) == wt
    assert not (dev / "hook-ran").exists()  # repo hooks never run through Orb
    assert remote(dev) == pushed


def test_a_clean_checkout_starts_at_head(dev):
    web = dev / "web"
    wt = wts.create(str(web), wts.branch_name(762, "Worktree, Apply and Discard!"))
    assert wt.branch == "orb/762-worktree-apply-and-discard" and wt.base == git(web, "rev-parse", "HEAD")
    with pytest.raises(wts.WorktreeError, match="already exists"):
        wts.create(str(web), wt.branch)
    with pytest.raises(wts.WorktreeError, match="not a valid branch"):
        wts.create(str(web), "orb/bad..name")


def test_the_fence_treats_a_registered_worktree_as_part_of_its_repo(dev):
    web, portal = dev / "web", dev / "acme" / "portal"
    wt = Path(wts.create(str(web), "orb/762-fix").path)
    cwt = Path(wts.create(str(portal), "orb/9-client").path)

    def rule(session: Path, tool: str, path: Path) -> str:
        f = Fence(str(session), root=dev, clients=("acme",), vault=None, never={"drafts"})
        return f.rule(tool, {"file_path": str(path)}).get("hookSpecificOutput", {}).get("permissionDecision", "ok")

    assert rule(web, "Edit", wt / "src" / "a.py") == "ok"  # the repo's own session
    assert rule(wt, "Edit", wt / "src" / "a.py") == "ok"  # the worktree's session
    assert rule(wt, "Edit", wt / ".env") == "deny" and rule(web, "Read", wt / ".env") == "deny"
    assert rule(wt, "Write", wt / "drafts" / "x.md") == "deny"
    assert rule(wt, "Edit", web / "a.txt") == "ask"  # the owner's checkout
    assert rule(cwt, "Edit", wt / "a.txt") == "ask"  # another repo's worktree, as that repo
    assert rule(web, "Edit", cwt / "a.txt") == "deny"  # a client repo's worktree is a client folder
    assert rule(portal, "Edit", cwt / "a.txt") == "ok"
    f = Fence(str(wt), root=dev, clients=("acme",), vault=None, never=set())
    assert f.rule("Edit", {"file_path": str(web / "a.txt")})["hookSpecificOutput"]["permissionDecisionReason"] == "Outside this worktree: the checkout of origin."  # labelled by remote
    assert Fence(str(cwt), root=dev, clients=("acme",), vault=None, never=set()).in_client()
    assert not f.in_client()



def test_the_fence_trusts_only_worktrees_git_links_to_the_repo_and_blocks_the_registry(dev):
    web, other = dev / "web", dev / "other"
    other.mkdir()
    wt = wts.create(str(web), "orb/762-fix")
    registry = config.STATE_DIR / "worktrees.json"
    data = json.loads(registry.read_text())
    data["worktrees"][str(other.resolve())] = {"repo": str(web.resolve()), "branch": "x", "base": wt.base}  # planted
    registry.write_text(json.dumps(data))
    assert wts.registered() == {wt.path: str(web.resolve())} and wts.get(str(other)) is None

    def rule(session, path: Path) -> str:
        f = Fence(str(session), root=dev, clients=(), vault=None, never=set())
        return f.rule("Write", {"file_path": str(path)}).get("hookSpecificOutput", {}).get("permissionDecision", "ok")

    assert rule(web, other / "x.txt") == "ask"  # still another folder, not part of web
    assert rule(wt.path, registry) == "deny" and rule(web, config.STATE_DIR / "sessions.json") == "deny"
    assert rule(wt.path, Path(wt.path) / "a.txt") == "ok"
    star = str(config.STATE_DIR.parent / (config.STATE_DIR.name[:2] + "*")) + "/worktrees.json"  # the shell expands it
    bash = Fence(wt.path, root=dev, clients=(), vault=None, never=set()).rule("Bash", {"command": f"cat {star}"})
    assert bash["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_apply_refuses_when_the_git_config_changed_since_create(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    commit(wt.path, {"d.txt": "delegated\n", ".gitattributes": "*.txt merge=x\n"}, "add d")
    git(wt.path, "config", "merge.x.driver", "touch pwned")  # a worktree shares the repo's config
    before = fingerprint(web)
    with pytest.raises(wts.WorktreeError, match="git config changed"):
        wts.apply(wt)
    assert fingerprint(web) == before and not (web / "pwned").exists()
    git(web, "config", "--unset", "merge.x.driver")
    assert wts.apply(wt)


def test_apply_squashes_the_delegations_work_onto_the_checkout_and_revert_undoes_it(dev):
    web = dev / "web"
    (web / "a.txt").write_text("a, mine\n")  # the owner's uncommitted work: in the snapshot, never committed
    wt = wts.create(str(web), "orb/762-fix")
    commit(wt.path, {"d.txt": "delegated\n"}, "add d")
    before, pushed = git(web, "rev-parse", "HEAD"), remote(dev)

    applied = wts.apply(wt)

    assert git(web, "rev-parse", "HEAD") == applied and git(web, "rev-parse", f"{applied}^") == before
    assert git(web, "rev-list", "--parents", "-n1", applied).count(" ") == 1  # one parent: a squash
    assert git(web, "show", "--name-only", "--format=", applied) == "d.txt"
    assert (web / "d.txt").read_text() == "delegated\n" and (web / "a.txt").read_text() == "a, mine\n"
    assert git(web, "status", "--porcelain") == "M a.txt"
    assert wts.remove(wt) == [] and not Path(wt.path).exists()

    undone = wts.revert(str(web), applied)
    assert git(web, "rev-parse", f"{undone}^{{tree}}") == git(web, "rev-parse", f"{before}^{{tree}}")
    assert not (web / "d.txt").exists() and (web / "a.txt").read_text() == "a, mine\n"
    assert git(web, "log", "-1", "--format=%s", undone) == 'Revert "Apply orb/762-fix"'
    assert remote(dev) == pushed


def test_apply_as_a_merge_commit(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    tip = commit(wt.path, {"d.txt": "delegated\n"}, "add d")
    head = git(web, "rev-parse", "HEAD")
    merged = wts.apply(wt, mode="merge")
    assert git(web, "rev-list", "--parents", "-n1", merged).split()[1:] == [head, tip]
    assert git(web, "log", "-1", "--format=%s", merged) == "Merge branch 'orb/762-fix' into main"
    undone = wts.revert(str(web), merged)
    assert git(web, "rev-parse", f"{undone}^{{tree}}") == git(web, "rev-parse", f"{head}^{{tree}}")


def test_a_conflicting_apply_touches_nothing(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    tip = commit(wt.path, {"c.txt": "one\nTWO (delegated)\nthree\n"}, "theirs")
    commit(web, {"c.txt": "one\nTWO (owner)\nthree\n"}, "ours")
    (web / "a.txt").write_text("a, mine\n")
    before = fingerprint(web)

    with pytest.raises(wts.Conflict) as err:
        wts.apply(wt)

    assert err.value.files == ["c.txt"] and "Nothing was merged" in str(err.value)
    assert fingerprint(web) == before and not (web / ".git" / "MERGE_HEAD").exists()
    assert git(web, "rev-parse", "refs/heads/orb/762-fix") == tip


def test_uncommitted_changes_in_a_file_the_apply_touches_stop_it(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    commit(wt.path, {"b.txt": "b, delegated\n"}, "theirs")
    (web / "b.txt").write_text("b, mine\n")
    before = fingerprint(web)
    with pytest.raises(wts.WorktreeError, match="Nothing changed"):
        wts.apply(wt)
    assert fingerprint(web) == before


def test_apply_refuses_without_work_or_on_the_branch_itself(dev):
    wt = wts.create(str(dev / "web"), "orb/762-fix")
    with pytest.raises(wts.WorktreeError, match="no commits"):
        wts.apply(wt)
    with pytest.raises(wts.WorktreeError, match="squash or merge"):
        wts.apply(wt, mode="rebase")


def test_discard_removes_the_worktree_and_the_branch(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    commit(wt.path, {"d.txt": "half done\n"}, "wip")
    (Path(wt.path) / "scratch.txt").write_text("uncommitted\n")
    pushed = remote(dev)
    assert wts.remove(wt) == []
    assert not Path(wt.path).exists() and wts.registered() == {}
    assert git(web, "branch", "--list", "orb/762-fix") == "" and git(web, "worktree", "list").count("\n") == 0
    assert remote(dev) == pushed


def test_a_rejected_push_names_the_branch_and_gits_reason_not_a_hint(dev):
    web = dev / "web"
    wt = wts.create(str(web), "orb/762-fix")
    first = commit(wt.path, {"a.txt": "ours\n"}, "ours")
    wts.push(wt, "origin", first)
    assert git(dev / "origin.git", "rev-parse", "orb/762-fix") == first

    other = dev / "other"  # someone else pushes the same branch name with their own commit
    git(dev, "clone", "-q", str(dev / "origin.git"), str(other))
    git(other, "checkout", "-q", "orb/762-fix")
    theirs = commit(other, {"b.txt": "theirs\n"}, "theirs")
    git(other, "push", "-q", "origin", "orb/762-fix")

    again = commit(wt.path, {"a.txt": "ours, again\n"}, "again")
    with pytest.raises(wts.WorktreeError) as e:
        wts.push(wt, "origin", again)
    assert str(e.value) == "Push of orb/762-fix to origin: rejected (fetch first)"
    assert git(dev / "origin.git", "rev-parse", "orb/762-fix") == theirs


def test_other_git_failures_keep_the_last_line_that_is_not_a_hint():
    out = subprocess.CompletedProcess([], 1, "", "error: failed to push some refs\nhint: Updates were rejected\nhint: See git help\n")
    assert wts._failure("push", out) == "git push failed: error: failed to push some refs"
    assert wts._failure("fetch", subprocess.CompletedProcess([], 1, "", "")) == "git fetch failed: "
