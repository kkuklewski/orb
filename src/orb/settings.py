"""Settings kept on the server (~/.orb/settings.json, mode 0600): what the onboarding sets up.

Per-browser choices (barge-in mode, theme, mute) stay in the page's localStorage; these are
the ones the server needs: which folders Orb may open, what it never opens, the optional notes
vault, speech engines, the Kokoro voice, and the approvals mode and front model new folders start in.
Nothing here is personal by default: a new install starts empty and runs the onboarding.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from . import config

DEFAULTS = {
    "voice": config.KOKORO_VOICE, "default_mode": "default", "default_model": "sonnet",
    "stt": config.STT, "tts": config.TTS,  # "browser" works out of the box; local engines are an upgrade
    "roots": [config.env("ROOT", "")] if config.env("ROOT", "") else [],  # folders Orb may open (and their repos)
    "skip_names": [],  # folder names never listed or entered, on top of folders.SKIP_NAMES
    "client_dirs": [d.strip() for d in config.env("CLIENT_DIRS", "").split(",") if d.strip()],
    "vault": config.env("VAULT", ""),  # an Obsidian-style notes repo; "" = no second-brain features
    "vault_protected": [],  # top folders of the vault whose edits always need a card
    "brain": False,  # claude.ai "Brain" / "Brain Capture" connectors in every session
    "routines": False,  # Routines panel (claude.ai scheduled agents)
    "routines_hidden": [n.strip() for n in config.env("ROUTINES_HIDDEN", "").split(",") if n.strip()],
    "onboarded": False,
}
MODES = ("default", "auto", "plan")
MODELS = ("sonnet", "opus")
STT = ("browser", "parakeet", "whisper")
TTS = ("browser", "kokoro")
NAME = re.compile(r"^[^/\\\0]{1,100}$")  # a single folder name, no path separators


def folder_root(raw: object) -> str | None:
    """An existing absolute folder the user may hand to Orb; never the filesystem root."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    p = Path(raw.strip()).expanduser()
    if not p.is_absolute() or not p.is_dir():
        return None
    p = p.resolve()
    return str(p) if p != Path(p.anchor) else None


def _names(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    return sorted({n.strip() for n in raw if isinstance(n, str) and NAME.match(n.strip()) and n.strip() not in (".", "..")})


class Settings:
    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            data = {}
        self.data = {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}

    def __getitem__(self, key: str):
        return self.data[key]

    def update(self, changes: dict) -> dict:
        if "voice" in changes and isinstance(changes["voice"], str) and changes["voice"].strip():
            self.data["voice"] = changes["voice"].strip()
        if changes.get("default_mode") in MODES:
            self.data["default_mode"] = changes["default_mode"]
        if changes.get("default_model") in MODELS:
            self.data["default_model"] = changes["default_model"]
        if changes.get("stt") in STT:
            self.data["stt"] = changes["stt"]
        if changes.get("tts") in TTS:
            self.data["tts"] = changes["tts"]
        if isinstance(changes.get("roots"), list):
            self.data["roots"] = list(dict.fromkeys(r for r in map(folder_root, changes["roots"]) if r))
        for key in ("skip_names", "client_dirs", "routines_hidden", "vault_protected"):
            if (names := _names(changes.get(key))) is not None:
                self.data[key] = names
        if "vault" in changes:
            self.data["vault"] = folder_root(changes["vault"]) or ""
        for key in ("brain", "routines", "onboarded"):
            if isinstance(changes.get(key), bool):
                self.data[key] = changes[key]
        self.save()
        return self.data

    def save(self) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # holds the user's folder paths
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(self.data, indent=2))
        os.replace(tmp, self.path)

    def roots(self) -> list[Path]:
        return [Path(r) for r in self.data["roots"]]

    def vault(self) -> Path | None:
        return Path(self.data["vault"]) if self.data["vault"] else None


settings = Settings(config.STATE_DIR / "settings.json")
