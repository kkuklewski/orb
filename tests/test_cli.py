"""Start in CLI: a Home item becomes a background Claude Code session (`claude --bg`) in its repo, the one the
`claude agents` view lists. The command is a fixed argv (no shell), the brief one argument, the repo only a path the
server already allowed."""

import os
import stat

import pytest

from orb import cli


def test_command_is_a_fixed_argv_with_the_brief_as_one_argument():
    argv = cli.command("Help me with a task.\n> Title: x; rm -rf /\n", "Fix checkout")
    assert argv[:2] == ["claude", "--bg"]
    assert argv[2:4] == ["--name", "Fix checkout"]
    assert argv[-1] == "Help me with a task.\n> Title: x; rm -rf /"  # stripped, otherwise as written: one argument
    assert argv[4] == "--" and len(argv) == 6  # a brief starting with "-" is still the prompt, not an option


def test_name_is_one_short_line():
    argv = cli.command("brief", "  Fix\nthe   checkout " + "x" * 100)
    name = argv[3]
    assert "\n" not in name and "  " not in name
    assert len(name) <= cli.NAME_MAX
    assert cli.command("brief", "   ")[3] == "Orb task"


@pytest.fixture
def fake_claude(tmp_path, monkeypatch):
    """A `claude` on PATH that records its argv and cwd, and prints like --bg does."""
    log = tmp_path / "log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "claude"
    exe.write_text("#!/bin/sh\nprintf '%s\\n' \"$PWD\" \"$@\" > \"$LOG\"\n"
                   "printf '%s\\n' 'backgrounded · bg-7f3a · Fix checkout' '  claude agents             list sessions' "
                   "'  claude attach bg-7f3a    open in this terminal' '  claude stop bg-7f3a      stop this session'\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("LOG", str(log))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-not-for-the-cli")
    return log


async def test_start_runs_claude_in_the_repo_and_returns_the_id(fake_claude, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    got = await cli.start(str(repo), "Help me with a task.", "Fix checkout")
    assert (got["id"], got["error"]) == ("bg-7f3a", None) and got["output"].startswith("backgrounded · bg-7f3a")
    lines = fake_claude.read_text().splitlines()
    assert lines[0] == str(repo.resolve())
    assert lines[1:] == ["--bg", "--name", "Fix checkout", "--", "Help me with a task."]


async def test_start_refuses_an_empty_brief(fake_claude, tmp_path):
    got = await cli.start(str(tmp_path), "  \n", "n")
    assert got["id"] is None and "empty" in got["error"] and not fake_claude.exists()


async def test_start_kills_a_claude_that_never_answers(fake_claude, tmp_path, monkeypatch):
    (tmp_path / "bin" / "claude").write_text("#!/bin/sh\nsleep 5\n")
    monkeypatch.setattr(cli, "TIMEOUT", 0.2)
    got = await cli.start(str(tmp_path), "brief", "n")
    assert got["id"] is None and "didn't answer" in got["error"] and "claude agents" in got["error"]


def test_session_id_comes_from_the_attach_hint_or_the_backgrounded_line():
    real = ("backgrounded · d94153d8 · orb-smoke3\n  claude agents             list sessions\n"
            "  claude attach d94153d8    open in this terminal\n  claude logs d94153d8      show recent output\n"
            "  claude stop d94153d8      stop this session\n")  # what claude --bg prints (Oct 2026)
    assert cli.session_id(real) == "d94153d8"
    assert cli.session_id("backgrounded · a1b2c3 · t") == "a1b2c3"
    assert cli.session_id("Started.") is None and cli.session_id("") is None


async def test_start_never_hands_the_cli_an_api_key(fake_claude, tmp_path):
    exe = tmp_path / "bin" / "claude"
    exe.write_text("#!/bin/sh\necho \"key=${ANTHROPIC_API_KEY-unset} tok=${ANTHROPIC_AUTH_TOKEN-unset} "
                   "bedrock=${CLAUDE_CODE_USE_BEDROCK-unset} mcp=${ENABLE_CLAUDEAI_MCP_SERVERS-unset}\"\n")
    monkeypatch_env = tmp_path  # the fixture set ANTHROPIC_API_KEY; billing's whole list is stripped, not just that
    os.environ["CLAUDE_CODE_USE_BEDROCK"] = "1"
    try:
        got = await cli.start(str(tmp_path), "brief", "n", {"ENABLE_CLAUDEAI_MCP_SERVERS": "false"})
    finally:
        del os.environ["CLAUDE_CODE_USE_BEDROCK"]
    assert got["output"] == "key=unset tok=unset bedrock=unset mcp=false", monkeypatch_env


async def test_a_missing_claude_or_a_failure_is_an_error_not_an_exception(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))  # no claude here
    got = await cli.start(str(tmp_path), "brief", "n")
    assert got["id"] is None and "claude" in got["error"]
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "claude"
    exe.write_text("#!/bin/sh\necho 'Not logged in' >&2\nexit 1\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", str(bin_dir))
    got = await cli.start(str(tmp_path), "brief", "n")
    assert got["id"] is None and got["error"] == "claude exited with 1: Not logged in"
