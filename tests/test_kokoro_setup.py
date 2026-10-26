import asyncio

import pytest

from orb import kokoro_setup as ks

SCRIPT = "uv run --no-sync uvicorn api.src.main:app --host 0.0.0.0 --port 8880\n"


@pytest.fixture
def mac(tmp_path, monkeypatch):
    monkeypatch.setattr(ks.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(ks.sys, "platform", "darwin")
    monkeypatch.setattr(ks, "_job", None)
    monkeypatch.setattr(ks, "_task", None)
    tools = {"uv": "/bin/uv"}
    monkeypatch.setattr(ks.shutil, "which", lambda name: tools.get(name))
    return tmp_path


def _install_voicemode(home):
    (home / ".local/bin").mkdir(parents=True, exist_ok=True)
    (home / ".local/bin/voicemode").write_text("")  # uv's tool folder, not always on Orb's PATH


def _install_kokoro(home):
    d = home / ".voicemode/services/kokoro"
    d.mkdir(parents=True, exist_ok=True)
    (d / "start-gpu_mac.sh").write_text(SCRIPT)
    (d / "start-cpu.sh").write_text(SCRIPT)


def _fake_run(home, ran, fail=None):
    async def run(*cmd, env=None):
        words = " ".join(c.rsplit("/", 1)[-1] for c in cmd)
        ran.append((words, env.get("VOICEMODE_SERVICE_AUTO_ENABLE") if env else None, ks.exposed()))
        if fail and fail in words:
            raise RuntimeError("❌ Failed to start kokoro: boom")
        if words == "uv tool install voice-mode":
            _install_voicemode(home)
        elif words == "voicemode service install kokoro":
            _install_kokoro(home)
        elif words == "voicemode service enable kokoro":
            (home / "Library/LaunchAgents").mkdir(parents=True)
            (home / "Library/LaunchAgents/com.voicemode.kokoro.plist").write_text("")
        return ""
    return run


def test_status_follows_each_step(mac):
    assert ks.status() == {"voicemode": False, "installed": False, "autostart": False, "exposed": False, "job": None}
    _install_voicemode(mac)
    _install_kokoro(mac)
    assert ks.status() | {"job": None} == {"voicemode": True, "installed": True, "autostart": False, "exposed": True,
                                           "job": None}
    assert ks.keep_local() == 2 and not ks.exposed() and ks.keep_local() == 0
    assert "--host 127.0.0.1 --port 8880" in (mac / ".voicemode/services/kokoro/start-gpu_mac.sh").read_text()


def test_status_is_none_off_a_mac(mac, monkeypatch):
    monkeypatch.setattr(ks.sys, "platform", "linux")
    assert ks.status() is None and ks.start() is False


def test_one_click_installs_and_keeps_it_local_before_it_starts(mac, monkeypatch):
    ran = []
    monkeypatch.setattr(ks, "_run", _fake_run(mac, ran))

    async def go():
        assert ks.start() and not ks.start()  # one at a time
        await ks._task
    asyncio.run(go())
    assert [r[0] for r in ran] == ["uv tool install voice-mode", "voicemode service install kokoro",
                                   "voicemode service enable kokoro"]
    assert ran[1][1] == "false"  # the install doesn't start it while it still listens everywhere
    assert ran[2][2] is False  # local-only before the first start
    assert ks.status()["autostart"] and not ks.status()["exposed"]
    assert ks.status()["job"]["running"] is False and ks.status()["job"]["error"] is None


def test_one_click_on_an_open_install_fixes_and_restarts(mac, monkeypatch):
    _install_voicemode(mac)
    _install_kokoro(mac)
    (mac / "Library/LaunchAgents").mkdir(parents=True)
    (mac / "Library/LaunchAgents/com.voicemode.kokoro.plist").write_text("")
    ran = []
    monkeypatch.setattr(ks, "_run", _fake_run(mac, ran))

    async def go():
        ks.start()
        await ks._task
    asyncio.run(go())
    assert ran == [("voicemode service restart kokoro", None, False)]


def test_a_failed_step_is_shown_and_can_be_tried_again(mac, monkeypatch):
    _install_voicemode(mac)
    _install_kokoro(mac)
    ran = []
    monkeypatch.setattr(ks, "_run", _fake_run(mac, ran, fail="enable"))

    async def go():
        ks.start()
        await ks._task
        failed = ks.status()["job"]
        again = ks.start()
        ks._task.cancel()
        return failed, again, ks.status()["job"]
    failed, again, job = asyncio.run(go())
    assert failed == {"step": "Starting it, and at every login", "running": False, "error": "❌ Failed to start kokoro: boom"}
    assert again and job == {"step": "Starting", "running": True, "error": None}


def test_run_counts_a_voicemode_cross_as_failure():
    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(ks._run("/bin/sh", "-c", "echo ok; echo '❌ Failed to start kokoro: boom'"))
    assert "hi" in asyncio.run(ks._run("/bin/sh", "-c", "echo hi"))
