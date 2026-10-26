import asyncio
import json

from orb import setup


def test_browse_stays_home_and_hides_secrets(tmp_path, monkeypatch):
    monkeypatch.setattr(setup.Path, "home", lambda: tmp_path)
    for d in ("code/api/.git", "code/secrets", "code/.hidden", "code/node_modules", "code/notes"):
        (tmp_path / d).mkdir(parents=True)
    r = setup.browse(str(tmp_path / "code"))
    assert [(e["name"], e["repo"]) for e in r["entries"]] == [("api", True), ("notes", False)]
    assert r["parent"] == str(tmp_path)
    assert setup.browse("/etc")["path"] == str(tmp_path)  # outside home: back to home
    assert setup.browse(str(tmp_path))["parent"] is None


def test_auth_status_keeps_no_account_details(monkeypatch):
    class Proc:
        async def communicate(self):
            return json.dumps({"loggedIn": True, "authMethod": "claude.ai", "subscriptionType": "max",
                               "email": "someone@example.com", "orgId": "org-1"}).encode(), b""

    async def fake_exec(*a, **k):
        return Proc()

    monkeypatch.setattr(setup.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(setup, "claude_binary", lambda: "/bin/claude")
    out = asyncio.run(setup.auth_status())
    assert out["loggedIn"] and out["subscription"] == "max" and out["subscriptionLogin"]
    assert "someone@example.com" not in json.dumps(out) and "org-1" not in json.dumps(out)


def test_kokoro_install_follows_each_step(tmp_path, monkeypatch):
    monkeypatch.setattr(setup.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(setup.shutil, "which", lambda name: None)
    assert setup.kokoro_install() == {"voicemode": False, "installed": False, "autostart": False}
    (tmp_path / ".local/bin").mkdir(parents=True)
    (tmp_path / ".local/bin/voicemode").write_text("")  # uv's tool folder, not always on Orb's PATH
    (tmp_path / ".voicemode/services/kokoro").mkdir(parents=True)
    assert setup.kokoro_install() == {"voicemode": True, "installed": True, "autostart": False}
    (tmp_path / "Library/LaunchAgents").mkdir(parents=True)
    (tmp_path / "Library/LaunchAgents/com.voicemode.kokoro.plist").write_text("")
    assert setup.kokoro_install()["autostart"]
