"""Vault sync (tickets 832 and 833, from 819): the read-only check of the vault clone, every vault write refusing while
it is conflicted, and the Needs you row. Real git repos in a temp folder, a local bare remote, made-up notes."""

import asyncio
import datetime as dt
import json
import os
import subprocess
import time

import pytest

from orb import desk, intake, needs, protocol, server, settings, vault_git, vault_write
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


# -- the Needs you row (ticket 833) ---------------------------------------------------------------------------------

H = 3600


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(vault_git, "_cache", {"at": 0.0, "vault": None, "health": None})


def plan(tmp_path):
    sent = []

    async def ask(prompt):
        return '{"items": []}'

    async def push(ev):
        protocol.PlanEvent.model_validate(ev)
        sent.append(ev)
    return needs.Needs(tmp_path / "needs.json", ask, push), sent


def no_names(row):
    text = json.dumps(row)
    assert "acme" not in text and "globex" not in text and "/" not in row["title"] + row["reason"] + row["facts"]


def test_a_real_conflict_is_a_red_vault_row_with_the_counts_open_only_and_unpinned(vault, remote, tmp_path):
    conflicted(vault, remote, tmp_path)
    row = needs.vault_row(vault_git.health(vault))
    day = dt.date.today()
    assert row["title"] == f"Vault: behind 1, ahead 1, 1 conflict · fetched {day.day} {day:%b}"
    assert (row["key"], row["kind"], row["reason"]) == ("vault:conflict", "vault", "Orb writes no notes until it's resolved")
    assert row["urgent"] and row["pin"] is None and row["actions"] == ["open"] and row["url"] is None
    no_names(row)


def test_a_diverged_clone_is_a_grey_row_that_turns_red_after_48h_on_the_since_clock(vault, remote, tmp_path):
    upstream_commit(remote, tmp_path)
    (vault / "globex.md").write_text("owner's commit\n")
    git(vault, "commit", "-qam", "owner")
    git(vault, "fetch", "-q")
    n, sent = plan(tmp_path)
    t0 = time.time()  # the page event ages rows on the real clock
    asyncio.run(n.update("2026-10-28", vault=[vault_git.health(vault)], now=t0))
    row = sent[-1]["needs_you"][0]
    assert row["key"] == "vault:diverged" and row["reason"] == "pull, then push" and not row["urgent"]
    assert row["title"].startswith("Vault: behind 1, ahead 1 · fetched ")
    assert n.state["since"] == {"vault:diverged": t0}
    assert not needs.aged(n.items, n.state["since"], "2026-10-28", t0 + 47 * H)[0]["urgent"]
    assert needs.aged(n.items, n.state["since"], "2026-10-28", t0 + 48 * H)[0]["urgent"]
    no_names(n.items[0])


def test_ahead_only_behind_only_and_dirty_only_give_no_row(vault, remote, tmp_path):
    (vault / "acme.md").write_text("dirty\n")
    assert needs.vault_row(vault_git.health(vault)) is None
    (vault / "globex.md").write_text("owner's commit\n")
    git(vault, "commit", "-qam", "owner")
    assert vault_git.health(vault).ahead == 1 and needs.vault_row(vault_git.health(vault)) is None
    git(vault, "reset", "-q", "--hard", "origin/main")
    upstream_commit(remote, tmp_path)
    git(vault, "fetch", "-q")
    assert vault_git.health(vault).behind == 1 and needs.vault_row(vault_git.health(vault)) is None
    assert needs.needs_you([], [], "2026-10-28", vault=[]) == [] and needs.vault_row(None) is None


def test_resolving_the_conflict_drops_the_row_and_its_since_key_at_the_next_check(vault, remote, tmp_path):
    conflicted(vault, remote, tmp_path)
    n, sent = plan(tmp_path)
    asyncio.run(n.update("2026-10-28", vault=[vault_git.health(vault)], now=1000.0))
    assert [r["key"] for r in sent[-1]["needs_you"]] == ["vault:conflict"] and n.state["since"] == {"vault:conflict": 1000.0}
    (vault / "acme.md").write_text("both lines\n")
    git(vault, "commit", "-qam", "merged")
    git(vault, "push", "-q")
    h = vault_git.health(vault)
    asyncio.run(n.update("2026-10-28", vault=[h] if h else [], now=2000.0))
    assert sent[-1]["needs_you"] == [] and n.state["since"] == {}


def test_an_unsafe_config_is_a_grey_cant_check_row_that_never_turns_red(vault, monkeypatch):
    git(vault, "config", "core.fsmonitor", "true")
    ran = []
    real = subprocess.run
    monkeypatch.setattr(vault_git.subprocess, "run", lambda args, *a, **kw: ran.append(args[8]) or real(args, *a, **kw))
    row = needs.vault_row(vault_git.health(vault))
    assert ran == ["config"]
    assert (row["key"], row["title"], row["reason"]) == ("vault:unchecked", "Vault: Orb can't check it", "its git config sets core.fsmonitor")
    assert not needs.aged([row], {row["key"]: 0.0}, "2026-10-28", 100 * H)[0]["urgent"]


def test_home_and_home_brief_share_the_five_minute_cache_while_a_write_checks_fresh(vault, remote, tmp_path, monkeypatch):
    calls = []
    real = vault_git.health
    monkeypatch.setattr(vault_git, "health", lambda v, full=True: calls.append(full) or real(v, full))
    assert vault_git.cached(vault) is not None and calls == [True]  # Home load
    src = desk.Sources(cfg=lambda: {}, vault=lambda: vault, folders=lambda: [], routines=lambda: None, sessions=lambda p: [])
    conflicted(vault, remote, tmp_path)
    assert desk._vault_section(src) == [] and calls == [True]  # home_brief within 5 minutes: the cached (clean) check
    with pytest.raises(TaskError, match=MID_MERGE):  # a write never trusts the cache
        vault_write.set_owner_read(vault, "globex.md", "")
    assert calls == [True, False]
    later = time.time() + vault_git.CACHE_SECONDS
    assert needs.vault_row(vault_git.cached(vault, later))["key"] == "vault:conflict"
    assert desk._vault_section(src)[0].endswith(": Orb writes no notes until it's resolved (urgent)")
