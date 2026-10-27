"""Vault sync (ticket 832, from 819): the read-only check of the vault clone, and every vault write refusing while it is
conflicted. Real git repos in a temp folder, a local bare remote, made-up notes."""

import asyncio
import os
import subprocess
import time

import pytest

from orb import intake, server, settings, vault_git, vault_write
from orb.vault_write import TaskError

NOTE = "---\ntitle: {name}\n---\n\n# {name}\n\n- [ ] call {name}\n"
MID_MERGE = r"Your vault is mid-merge \(1 conflict\); Orb writes nothing there until you finish it\."


def git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), "-c", "user.email=owner@acme.example", "-c", "user.name=Owner",
                           *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def remote(tmp_path):
    r = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(r)], check=True)
    seed = tmp_path / "seed"
    git(tmp_path, "init", "-q", "-b", "main", str(seed))
    for name in ("acme.md", "globex.md"):
        (seed / name).write_text(NOTE.format(name=name))
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "start")
    git(seed, "remote", "add", "origin", str(r))
    git(seed, "push", "-qu", "origin", "main")
    return r


@pytest.fixture
def vault(remote, tmp_path):
    v = tmp_path / "notes"
    subprocess.run(["git", "clone", "-q", str(remote), str(v)], check=True)
    return v


def upstream_commit(remote, tmp_path, text="the VPS's line\n"):
    """Someone else (the VPS) changes acme.md and pushes."""
    other = tmp_path / "other"
    if not other.exists():
        subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / "acme.md").write_text(text)
    git(other, "commit", "-qam", "vps")
    git(other, "push", "-q")


def conflicted(vault, remote, tmp_path):
    """A real merge conflict on acme.md: the owner's commit against the VPS's, then `git pull` stops."""
    upstream_commit(remote, tmp_path)
    (vault / "acme.md").write_text("the owner's line\n")
    git(vault, "commit", "-qam", "owner")
    r = subprocess.run(["git", "-C", str(vault), "-c", "pull.rebase=false", "pull", "-q"], capture_output=True)
    assert r.returncode  # the merge stopped on the conflict


def test_a_clean_clone_is_all_zero_and_not_conflicted(vault):
    h = vault_git.health(vault)
    assert (h.ahead, h.behind, h.changed, h.unmerged, h.operation, h.why) == (0, 0, 0, 0, "", "")
    assert not h.conflicted and not h.diverged


def test_a_merge_conflict_is_one_unmerged_path_and_a_merge_then_none_once_resolved(vault, remote, tmp_path):
    conflicted(vault, remote, tmp_path)
    h = vault_git.health(vault)
    assert (h.unmerged, h.operation, h.conflicted) == (1, "merge", True)
    assert h.refusal() == "Your vault is mid-merge (1 conflict); Orb writes nothing there until you finish it."
    (vault / "acme.md").write_text("both lines\n")
    git(vault, "commit", "-qam", "merged")
    h = vault_git.health(vault)
    assert (h.unmerged, h.operation, h.conflicted, h.ahead, h.behind) == (0, "", False, 2, 0)


def test_ahead_behind_and_changed_against_a_local_remote_and_the_fetch_time(vault, remote, tmp_path):
    assert vault_git.health(vault).fetched is None  # a fresh clone has no FETCH_HEAD
    upstream_commit(remote, tmp_path)
    (vault / "globex.md").write_text("owner's commit\n")
    git(vault, "commit", "-qam", "owner")
    (vault / "acme.md").write_text("dirty\n")
    (vault / "new.md").write_text("untracked\n")
    assert vault_git.health(vault).behind == 0  # not fetched yet: behind is as of the last fetch
    git(vault, "fetch", "-q")
    h = vault_git.health(vault)
    assert (h.ahead, h.behind, h.changed, h.diverged, h.conflicted) == (1, 1, 2, True, False)
    assert h.fetched and abs(h.fetched - time.time()) < 60


def test_a_rebase_stopped_on_a_conflict_is_conflicted(vault, remote, tmp_path):
    upstream_commit(remote, tmp_path)
    (vault / "acme.md").write_text("the owner's line\n")
    git(vault, "commit", "-qam", "owner")
    git(vault, "fetch", "-q")
    assert subprocess.run(["git", "-C", str(vault), "rebase", "-q", "origin/main"], capture_output=True).returncode
    h = vault_git.health(vault)
    assert h.operation == "rebase" and h.unmerged == 1
    with pytest.raises(TaskError, match=r"mid-rebase \(1 conflict\)"):
        vault_write.set_owner_read(vault, "globex.md", "")


def test_only_read_commands_run_each_without_optional_locks_and_hooks(vault, monkeypatch):
    ran = []
    real = subprocess.run

    def record(args, *a, **kw):
        ran.append(args)
        assert kw["env"]["GIT_TERMINAL_PROMPT"] == "0"
        return real(args, *a, **kw)
    monkeypatch.setattr(vault_git.subprocess, "run", record)
    vault_git.health(vault)
    assert [a[8] for a in ran] == ["config", "rev-parse", "ls-files", "status"]
    for a in ran:
        assert a[:3] == ["git", "--no-optional-locks", "-C"]
        assert a[4:8] == ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]
    ran.clear()
    vault_git.health(vault, full=False)  # the check before a write: no status
    assert [a[8] for a in ran] == ["config", "rev-parse", "ls-files"]


def test_an_unsafe_git_config_key_runs_nothing_and_says_why(vault, monkeypatch, tmp_path):
    marker = tmp_path / "ran"
    git(vault, "config", "core.fsmonitor", f"touch {marker} #")
    ran = []
    real = subprocess.run
    monkeypatch.setattr(vault_git.subprocess, "run", lambda args, *a, **kw: ran.append(args[8]) or real(args, *a, **kw))
    h = vault_git.health(vault)
    assert ran == ["config"] and "core.fsmonitor" in h.why and not h.conflicted and not marker.exists()


def test_no_vault_or_no_git_repo_is_no_check(tmp_path):
    assert vault_git.health(None) is None
    assert vault_git.health(tmp_path / "plain") is None
    (tmp_path / "plain").mkdir()
    assert vault_git.health(tmp_path / "plain") is None


def test_every_write_refuses_on_a_conflicted_clone_and_leaves_the_files(vault, remote, tmp_path):
    conflicted(vault, remote, tmp_path)
    before = (vault / "globex.md").read_bytes()
    with pytest.raises(TaskError, match=MID_MERGE):
        vault_write.set_verdict(vault, {"globex.md": ""}, "approve")
    with pytest.raises(TaskError, match=MID_MERGE):
        vault_write.set_verdicts(vault, [{"file": "globex.md", "seen": "", "verdict": "reject"}])
    with pytest.raises(TaskError, match=MID_MERGE):
        vault_write.set_owner_read(vault, "globex.md", "")
    with pytest.raises(TaskError, match=MID_MERGE):
        vault_write.set_task_line(vault, "globex.md", 7, "- [ ] call globex.md", "- [x] call globex.md ✅ 2026-10-28")
    with pytest.raises(TaskError, match=MID_MERGE):
        vault_write.new_transcript(vault, "dQw4w9WgXcQ", "Acme talk", "en", "Hello.")
    assert (vault / "globex.md").read_bytes() == before and not (vault / vault_write.TRANSCRIPTS).exists()


def test_a_dirty_clone_that_isnt_conflicted_still_writes(vault):
    (vault / "acme.md").write_text(NOTE.format(name="acme.md") + "owner's edit\n")  # uncommitted
    vault_write.set_task_line(vault, "globex.md", 7, "- [ ] call globex.md", "- [x] call globex.md ✅ 2026-10-28")
    vault_write.set_verdict(vault, {"globex.md": ""}, "approve")
    vault_write.set_owner_read(vault, "acme.md", "")
    assert vault_write.new_transcript(vault, "dQw4w9WgXcQ", "Acme talk", "en", "Hello.").startswith(vault_write.TRANSCRIPTS)
    assert "human_verdict: approve" in (vault / "globex.md").read_text()


async def test_a_youtube_drop_on_a_conflicted_vault_runs_no_fetch_and_fails_with_the_reason(vault, remote, tmp_path,
                                                                                            monkeypatch):
    marker = tmp_path / "fetched"
    script = vault / "tools" / "fetch.sh"
    script.parent.mkdir()
    script.write_text(f"touch {marker}\n")
    git(vault, "add", "tools/fetch.sh")
    git(vault, "commit", "-qm", "fetch script")
    conflicted(vault, remote, tmp_path)

    class Conn:
        sent: list = []

        async def send(self, ev):
            self.sent.append(ev)
    conn = Conn()
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setitem(settings.settings.data, "brain", True)
    monkeypatch.setitem(settings.settings.data, "vault", str(vault))
    monkeypatch.setitem(settings.settings.data, "transcript_script", "tools/fetch.sh")
    monkeypatch.setattr(server.hub, "conns", [conn])
    await server.handle(conn, {"type": "drop", "url": "https://youtu.be/dQw4w9WgXcQ"})
    assert conn.sent[-1]["type"] == "drop_routed" and conn.sent[-1]["route"] == "youtube"
    for _ in range(100):
        if conn.sent[-1]["type"] == "drop_done":
            break
        await asyncio.sleep(0.02)
    done = conn.sent[-1]
    assert done["type"] == "drop_done" and done["ok"] is False
    assert done["text"] == "Your vault is mid-merge (1 conflict); Orb writes nothing there until you finish it."
    assert not marker.exists() and not (vault / vault_write.TRANSCRIPTS).exists()
    assert intake.youtube_id("https://youtu.be/dQw4w9WgXcQ")  # the route really was the job, not a session
    assert os.listdir(vault / "tools") == ["fetch.sh"]
