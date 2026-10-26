"""Paths, ports and endpoints. Override with ORB_* environment variables (the older
VOICE_DASHBOARD_* names still work)."""

from __future__ import annotations

import os
import re
import secrets
import urllib.request
from pathlib import Path


def env(name: str, default: str) -> str:
    """ORB_<name>, else the pre-rename VOICE_DASHBOARD_<name>, else default."""
    return os.environ.get(f"ORB_{name}") or os.environ.get(f"VOICE_DASHBOARD_{name}") or default


# Tracker credentials: read once, then dropped from the environment, which every Claude Code session and its
# Bash calls inherit. secret() still sees a variable set later (tests).
SECRET_NAMES = ("VIKUNJA_TOKEN", "JIRA_EMAIL", "JIRA_TOKEN")
_secrets = {name: os.environ.pop(f"ORB_{name}", "") or os.environ.pop(f"VOICE_DASHBOARD_{name}", "")
            for name in SECRET_NAMES}


def secret(name: str) -> str:
    return env(name, "") or _secrets.get(name, "")


HOME = Path.home()
LEGACY_STATE = HOME / ".voice-dashboard"
STATE_DIR = Path(env("STATE", str(HOME / ".orb")))

HOST = "127.0.0.1"  # never 0.0.0.0: the page can run tools on this Mac
PORT = int(env("PORT", "8765"))
# Host names the server answers to (a DNS-rebinding page sends its own): this machine and the comma-separated
# ORB_HOSTS; in the personal profile also a Tailscale name (`tailscale serve`, *.ts.net, server.host_ok).
HOSTS = {"127.0.0.1", "localhost", "[::1]", *(h.strip().lower() for h in env("HOSTS", "").split(",") if h.strip())}

STT = env("STT", "parakeet")  # "parakeet" (Whisper as fallback), "whisper" or "browser" (the page's own: Chrome sends the audio to Google)
TTS = env("TTS", "browser")  # "browser" (the page's own voices) or "kokoro"
WHISPER_URL = env("WHISPER", "http://127.0.0.1:2022/v1/audio/transcriptions")
KOKORO_URL = env("KOKORO", "http://127.0.0.1:8880/v1/audio/speech")
CHATTERBOX_URL = env("CHATTERBOX", "http://127.0.0.1:8881/v1/audio/speech")  # spikes/chatterbox
KOKORO_VOICE = env("VOICE", "af_heart")  # the best-rated Kokoro voice

# Development only: the Vite dev server's origin (web/, `npm run dev`) the WebSocket check also
# accepts. Off by default; only a plain-http localhost origin is taken.
_dev = env("DEV_ORIGIN", "").rstrip("/")
DEV_ORIGIN = _dev if re.fullmatch(r"http://(localhost|127\.0\.0\.1):\d{2,5}", _dev) else ""

MAX_LIVE_SESSIONS = int(env("MAX_SESSIONS", "4"))
IDLE_CLOSE_SECONDS = int(env("IDLE_CLOSE", str(30 * 60)))


def migrate_state(state: Path = STATE_DIR, legacy: Path = LEGACY_STATE) -> bool:
    """Move the pre-rename ~/.voice-dashboard to ~/.orb once, leaving a link at the old path so an
    older build still finds its sessions. Only for the default location; True when it moved."""
    if state.exists() or not legacy.is_dir() or legacy.is_symlink():
        return False
    legacy.rename(state)
    legacy.symlink_to(state)
    return True


_token = ""


def token() -> str:
    """Shared secret the page must present on the WebSocket: a new one on every start (a link or a page's
    stored copy from an earlier run stops working), kept in memory and written 0600 for the spikes."""
    global _token
    if _token:
        return _token
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if STATE_DIR.stat().st_mode & 0o077:
        STATE_DIR.chmod(0o700)
    path = STATE_DIR / "token"
    path.unlink(missing_ok=True)  # never reuse or write through what is there (another owner, a link)
    value = secrets.token_urlsafe(24)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(value)
    _token = value
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # the 3xx comes back as an HTTPError


_opener = urllib.request.build_opener(_NoRedirect)


def urlopen(req: urllib.request.Request, timeout: float):
    """The tracker clients' HTTP: no redirects, so the Authorization header never goes to another address."""
    return _opener.open(req, timeout=timeout)


def write_private(path: Path, text: str) -> None:
    """Replace a state file atomically, 0600 in a 0700 folder (they hold folder paths, prompts, task names)."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)  # a leftover tmp keeps its old mode otherwise
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def append_private(path: Path, text: str) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "a") as f:
        f.write(text)
