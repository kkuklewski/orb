"""Paths, ports and endpoints. Override with ORB_* environment variables (the older
VOICE_DASHBOARD_* names still work)."""

from __future__ import annotations

import os
import re
import secrets
from pathlib import Path


def env(name: str, default: str) -> str:
    """ORB_<name>, else the pre-rename VOICE_DASHBOARD_<name>, else default."""
    return os.environ.get(f"ORB_{name}") or os.environ.get(f"VOICE_DASHBOARD_{name}") or default


HOME = Path.home()
LEGACY_STATE = HOME / ".voice-dashboard"
STATE_DIR = Path(env("STATE", str(HOME / ".orb")))

HOST = "127.0.0.1"  # never 0.0.0.0: the page can run tools on this Mac
PORT = int(env("PORT", "8765"))

STT = env("STT", "browser")  # "browser" (the page's own), "parakeet" (Whisper as fallback) or "whisper"
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


def token() -> str:
    """Shared secret the page must present on the WebSocket (file mode 0600, folder 0700)."""
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if STATE_DIR.stat().st_mode & 0o077:
        STATE_DIR.chmod(0o700)
    path = STATE_DIR / "token"
    try:
        st = path.stat()
        if st.st_uid == os.getuid() and not st.st_mode & 0o077:
            value = path.read_text().strip()
            if value:
                return value
        path.unlink()  # wrong owner, too open or empty: replace it
    except FileNotFoundError:
        pass
    value = secrets.token_urlsafe(24)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(value)
    return value
