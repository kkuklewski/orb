"""`orb open` (the running server's link from its 0600 token file) and the login job's tracker variables."""

import os
import plistlib
import socket
import subprocess
import sys
from pathlib import Path

import pytest

import orb
from orb import config

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def listening(monkeypatch, tmp_path):
    """A server on a free 127.0.0.1 port and a private state folder, as `orb` at login leaves them."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen()
    monkeypatch.setattr(config, "PORT", s.getsockname()[1])
    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    opened = []
    monkeypatch.setattr("webbrowser.open", opened.append)
    yield opened
    s.close()


def write_token(folder: Path, value: str, mode: int = 0o600) -> Path:
    path = folder / "token"
    path.write_text(value)
    path.chmod(mode)
    return path


def test_open_prints_and_opens_the_running_servers_link(listening, tmp_path, capsys):
    write_token(tmp_path, "tok-123")
    assert orb.open_page() == 0
    url = f"http://127.0.0.1:{config.PORT}/#t=tok-123"
    assert listening == [url]
    assert url in capsys.readouterr().out


def test_open_with_nothing_running_says_how_to_start(monkeypatch, tmp_path, capsys):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        free = s.getsockname()[1]
    monkeypatch.setattr(config, "PORT", free)
    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    write_token(tmp_path, "tok-123")
    opened = []
    monkeypatch.setattr("webbrowser.open", opened.append)
    assert orb.open_page() == 1
    assert opened == []
    assert "isn't running" in capsys.readouterr().err


@pytest.mark.parametrize("bad", ["open to others", "a link", "missing"])
def test_open_refuses_a_token_file_it_cant_trust(listening, tmp_path, bad):
    if bad == "open to others":
        write_token(tmp_path, "tok-123", 0o644)
    elif bad == "a link":
        (tmp_path / "elsewhere").mkdir()
        (tmp_path / "token").symlink_to(write_token(tmp_path / "elsewhere", "tok-123"))
    assert config.saved_token() == ""
    assert orb.open_page() == 1
    assert listening == []


def test_second_start_leaves_the_running_servers_token_alone(listening, tmp_path, monkeypatch):
    path = write_token(tmp_path, "tok-123")
    monkeypatch.setattr(config, "token", lambda: pytest.fail("a second start must not make a token"))
    with pytest.raises(SystemExit) as e:
        orb.main([])
    assert e.value.code == 1
    assert path.read_text() == "tok-123"


def test_start_before_the_first_one_binds_is_stopped_by_the_lock(monkeypatch, tmp_path):
    """The first Orb prints its link before uvicorn binds: the port is still free, the state lock is not."""
    import fcntl

    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    monkeypatch.setattr(config, "port_in_use", lambda: False)
    assert config.claim_state()  # the first server
    first = config._lock
    monkeypatch.setattr(config, "_lock", None)
    path = write_token(tmp_path, "tok-123")
    monkeypatch.setattr(config, "token", lambda: pytest.fail("a second start must not make a token"))
    try:
        with pytest.raises(SystemExit) as e:
            orb.main([])
        assert e.value.code == 1
        assert path.read_text() == "tok-123"
        assert (tmp_path / "orb.lock").stat().st_mode & 0o777 == 0o600
    finally:
        fcntl.flock(first, fcntl.LOCK_UN)
        os.close(first)
    assert config.claim_state()  # free again once the first one is gone
    os.close(config._lock)


def test_main_routes_open_and_refuses_unknown_words(listening, tmp_path):
    write_token(tmp_path, "tok-123")
    with pytest.raises(SystemExit) as e:
        orb.main(["open"])
    assert e.value.code == 0 and len(listening) == 1
    with pytest.raises(SystemExit) as e:
        orb.main(["serve"])
    assert e.value.code == 2


# install-launchd.sh, run with a throwaway HOME and stand-ins for `orb` and `launchctl`.

TRACKER = ("ORB_VIKUNJA_URL", "ORB_VIKUNJA_TOKEN", "ORB_JIRA_URL", "ORB_JIRA_EMAIL", "ORB_JIRA_TOKEN", "ORB_JIRA_JQL")
needs_mac = pytest.mark.skipif(sys.platform != "darwin" or not Path("/usr/libexec/PlistBuddy").exists(),
                               reason="keeps earlier values through macOS PlistBuddy")


@pytest.fixture
def install(tmp_path):
    home, bin_ = tmp_path / "home", tmp_path / "bin"
    home.mkdir()
    bin_.mkdir()
    (bin_ / "orb").write_text("#!/bin/sh\n")
    (bin_ / "launchctl").write_text(f'#!/bin/sh\necho "$@" >> "{tmp_path}/launchctl.log"\n')
    for f in bin_.iterdir():
        f.chmod(0o755)
    base = {k: v for k, v in os.environ.items() if k not in TRACKER and not k.startswith("ANTHROPIC_")}
    base.update(HOME=str(home), PATH=f"{bin_}:/usr/bin:/bin")
    plist = home / "Library/LaunchAgents/dev.orb.server.plist"

    def run(**env):
        out = subprocess.run(["sh", str(ROOT / "deploy/install-launchd.sh")], env={**base, **env},
                             capture_output=True, text=True, check=True)
        return out.stdout, plistlib.loads(plist.read_bytes())

    run.plist, run.home, run.log = plist, home, tmp_path / "launchctl.log"
    return run


def test_login_job_gets_the_tracker_tokens_in_a_private_plist(install):
    out, job = install(ORB_VIKUNJA_TOKEN="vk&<1>", ORB_JIRA_EMAIL="ada@acme.example", ORB_JIRA_TOKEN="jt-2")
    assert job["EnvironmentVariables"] == {"ORB_VIKUNJA_TOKEN": "vk&<1>", "ORB_JIRA_EMAIL": "ada@acme.example",
                                           "ORB_JIRA_TOKEN": "jt-2"}
    assert job["ProgramArguments"] == [str(install.home.parent / "bin/orb")]
    assert install.plist.stat().st_mode & 0o777 == 0o600
    assert "vk&" not in out and "jt-2" not in out  # names only, never values
    assert not (install.home / ".orb/settings.json").exists()
    assert list(install.plist.parent.iterdir()) == [install.plist]  # no temp file left behind
    assert "bootstrap" in install.log.read_text()


def test_login_job_without_tokens_has_no_environment(install):
    _, job = install()
    assert "EnvironmentVariables" not in job
    assert job["Label"] == "dev.orb.server" and job["KeepAlive"] is True


@needs_mac
def test_rerun_keeps_tokens_not_exported_and_drops_emptied_ones(install):
    install(ORB_VIKUNJA_TOKEN="vk-1", ORB_JIRA_TOKEN="jt-2")
    _, job = install(ORB_JIRA_TOKEN="")
    assert job["EnvironmentVariables"] == {"ORB_VIKUNJA_TOKEN": "vk-1"}
    assert "bootout" in install.log.read_text()  # the running job is replaced, not stacked


def test_script_parses_as_plain_sh():
    subprocess.run(["sh", "-n", str(ROOT / "deploy/install-launchd.sh")], check=True)
