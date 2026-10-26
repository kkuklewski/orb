import asyncio
import os
import shlex
import time
from pathlib import Path

import pytest

from orb import delegation, sandbox
from orb.grant import Grant

live = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")
TEST = "uv run pytest -q"


def test_a_declared_command_is_covered_only_with_the_sandbox(tmp_path, monkeypatch):
    g = Grant(str(tmp_path), "orb/x", (TEST,))
    monkeypatch.setattr(sandbox, "available", lambda: False)
    assert not g.covers("Bash", {"command": TEST})
    monkeypatch.setattr(sandbox, "available", lambda: True)
    assert g.covers("Bash", {"command": "uv  run pytest -q"})
    words = shlex.split(g.safe_input("Bash", {"command": TEST, "timeout": 60000})["command"])
    assert words[:2] == ["/usr/bin/env", "-i"] and sandbox.SANDBOX_EXEC in words and words[-2:] == ["-c", TEST]


def test_the_environment_keeps_only_the_basics(tmp_path, monkeypatch):
    for k in ("ORB_VIKUNJA_TOKEN", "GH_TOKEN", "HTTPS_PROXY", "CLAUDE_CODE_OAUTH_TOKEN", "SSH_AUTH_SOCK"):
        monkeypatch.setenv(k, "x")
    env = sandbox.env(str(tmp_path))
    assert not {"ORB_VIKUNJA_TOKEN", "GH_TOKEN", "HTTPS_PROXY", "CLAUDE_CODE_OAUTH_TOKEN", "SSH_AUTH_SOCK"} & set(env)
    assert env["UV_CACHE_DIR"].startswith(sandbox.cache_dir(str(tmp_path)))
    assert not env["UV_CACHE_DIR"].startswith(os.path.realpath(tmp_path))  # never in the worktree


def test_path_folders_and_their_install_roots_are_readable_but_never_credentials(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".local" / "bin").mkdir(parents=True)
    (home / ".acme" / "node" / "bin").mkdir(parents=True)
    (home / ".acme" / "node" / "bin" / "node").write_text("")
    (home / ".local" / "bin" / "node").symlink_to(home / ".acme" / "node" / "bin" / "node")
    (home / ".ssh").mkdir()
    monkeypatch.setenv("PATH", os.pathsep.join([str(home / ".local" / "bin"), str(home / ".ssh"), str(home), "/usr/bin"]))
    reads = sandbox.path_reads(os.path.realpath(home))
    assert reads == [os.path.realpath(home / ".local" / "bin"), os.path.realpath(home / ".acme" / "node")]


@pytest.fixture
def box(tmp_path, monkeypatch):
    home, wt = tmp_path / "home", tmp_path / "wt"
    home.mkdir()
    wt.mkdir()
    (home / "secret.txt").write_text("hunter2")
    monkeypatch.setenv("HOME", str(home))
    return home, wt


@live
def test_the_sandbox_reads_and_writes_only_the_worktree(box):
    home, wt = box
    ok, first = asyncio.run(delegation.run_tests(str(wt), f"echo hi > out.txt && cat {home}/secret.txt"))
    assert not ok and (wt / "out.txt").read_text() == "hi\n"
    outside = Path(__file__).parent / ".planted-by-sandbox-test"  # the temp folders are writable: use the repo
    ok, _ = asyncio.run(delegation.run_tests(str(wt), f"echo x > {outside}"))
    assert not ok and not outside.exists()
    ok, _ = asyncio.run(delegation.run_tests(str(wt), 'test -z "$ORB_VIKUNJA_TOKEN" && test -d "$TMPDIR"'))
    assert ok


@live
def test_a_timed_out_run_kills_its_whole_group(box):
    _, wt = box
    ok, why = asyncio.run(delegation.run_tests(str(wt), "sleep 30 & echo $! > pid; wait", timeout=1))
    assert not ok and "timed out" in why
    pid = int((wt / "pid").read_text())
    time.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
