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

from . import chain, config

DEFAULTS = {
    "voice": config.KOKORO_VOICE, "default_mode": "default", "default_model": "sonnet",
    "coder_effort": chain.DEFAULT_CODER_EFFORT,  # how hard the Opus coder thinks: low / medium / high
    "stt": config.STT, "tts": config.TTS,  # "browser" works out of the box; local engines are an upgrade
    "roots": [config.env("ROOT", "")] if config.env("ROOT", "") else [],  # folders Orb may open (and their repos)
    "skip_names": [],  # folder names never listed or entered, on top of folders.SKIP_NAMES
    "client_dirs": [d.strip() for d in config.env("CLIENT_DIRS", "").split(",") if d.strip()],
    "vault": config.env("VAULT", ""),  # an Obsidian-style notes repo; "" = no second-brain features
    "vault_protected": [],  # top folders of the vault whose edits always need a card
    "brain": False,  # claude.ai "Brain" / "Brain Capture" connectors in every session
    "transcript_script": config.env("TRANSCRIPT_SCRIPT", ""),  # the vault's YouTube transcript fetch script (vault-relative); "" = no YouTube drops
    "transcripts_folder": "",  # where a dropped video's transcript goes (vault-relative); "" = vault_write.TRANSCRIPTS
    "routines": False,  # Routines panel (claude.ai scheduled agents)
    "routines_judge": True,  # Haiku judges each result: only the ones worth reading notify (off: every result does)
    "routines_notify": {},  # routine id -> "always" | "never": overrides the judge for that routine's results
    "routines_hidden": [n.strip() for n in config.env("ROUTINES_HIDDEN", "").split(",") if n.strip()],
    "reminders": [],  # home "Don't forget": [{"text", "due": "YYYY-MM-DD" (optional), "url" (optional)}]
    "links": [],  # home pinned links: [{"label", "url"}]
    "vikunja_url": config.env("VIKUNJA_URL", ""),  # open tasks from Vikunja (token: ORB_VIKUNJA_TOKEN, env only)
    "jira_url": config.env("JIRA_URL", ""),  # or from Jira Cloud, which wins when set (ORB_JIRA_EMAIL + ORB_JIRA_TOKEN, env only)
    "tasks_inbox": config.env("TASKS_INBOX", "Inbox"),  # the project a new task with no mapped repo goes to
    "delegation_limit": 3,
    "sandbox_read": [],  # extra home folders a delegation's test/build commands may read (toolchains); settings.json only  # delegations working at once; the next ones wait as Queued
    "onboarded": False,
}
MODES = ("default", "auto", "plan")
MODELS = chain.MODELS
STT = ("browser", "parakeet", "whisper")
TTS = ("browser", "kokoro")
NOTIFY_MODES = ("always", "never")
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


def _web(url: object) -> bool:
    return isinstance(url, str) and url.startswith(("http://", "https://")) and len(url) <= 500


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
        if changes.get("coder_effort") in chain.CODER_EFFORTS:
            self.data["coder_effort"] = changes["coder_effort"]
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
        if isinstance(changes.get("routines_notify"), dict):  # merged, so a hidden routine's choice survives
            merged = dict(self.data.get("routines_notify") or {})
            for rid, mode in changes["routines_notify"].items():
                if isinstance(rid, str) and 0 < len(rid) <= 80:
                    if mode in NOTIFY_MODES:
                        merged[rid] = mode
                    else:
                        merged.pop(rid, None)  # "auto" (or anything else): back to the judge
            self.data["routines_notify"] = dict(list(merged.items())[-100:])
        if isinstance(changes.get("reminders"), list):
            self.data["reminders"] = [{k: str(x[k])[:300] for k in ("text", "due", "url") if x.get(k)}
                                      for x in changes["reminders"][:100] if isinstance(x, dict) and x.get("text")]
        if isinstance(changes.get("links"), list):
            self.data["links"] = [{"label": str(x.get("label") or x["url"])[:80], "url": str(x["url"])}
                                  for x in changes["links"][:50] if isinstance(x, dict) and _web(x.get("url"))]
        if isinstance(changes.get("delegation_limit"), int) and not isinstance(changes["delegation_limit"], bool):
            self.data["delegation_limit"] = min(max(changes["delegation_limit"], 1), 10)
        for key in ("vikunja_url", "jira_url"):
            if key in changes:
                self.data[key] = str(changes[key]).strip() if _web(changes[key]) else ""
        if isinstance(changes.get("tasks_inbox"), str) and NAME.match(changes["tasks_inbox"].strip()):
            self.data["tasks_inbox"] = changes["tasks_inbox"].strip()
        for key in ("brain", "routines", "routines_judge", "onboarded"):
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
