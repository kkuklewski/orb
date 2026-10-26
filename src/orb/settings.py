"""Settings kept on the server (~/.orb/settings.json, mode 0600): what the onboarding sets up.

Per-browser choices (barge-in mode, theme, mute) stay in the page's localStorage; these are
the ones the server needs: which folders Orb may open, what it never opens, the optional notes
vault, speech engines, the Kokoro voice, and the approvals mode and front model new folders start in.
Nothing here is personal by default: a new install starts empty and runs the onboarding.

The profile keeps a work machine clean. "work" (a new install's default): no claude.ai connectors, no browser
speech recognition (Chrome sends the audio to Google), every other repo in the roots is fenced like a client
folder, and the page answers on localhost only. "personal" turns on what the owner set up (Brain, connectors,
browser speech, a card for other repos, Tailscale serve). An install from before profiles counts as personal.
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
    "stt": config.STT, "tts": config.TTS,  # speech in on this Mac by default; "browser" (Google) only in personal
    "roots": [config.env("ROOT", "")] if config.env("ROOT", "") else [],  # folders Orb may open (and their repos)
    "skip_names": [],  # folder names never listed or entered, on top of folders.SKIP_NAMES
    "client_dirs": [d.strip() for d in config.env("CLIENT_DIRS", "").split(",") if d.strip()],
    "vault": config.env("VAULT", ""),  # an Obsidian-style notes repo; "" = no second-brain features
    "vault_protected": [],  # top folders of the vault whose edits always need a card
    "profile": "work",  # "work" or "personal": see the module docstring
    "brain": False,  # claude.ai "Brain" / "Brain Capture" connectors in every session (personal profile)
    "connectors": False,  # the other claude.ai connectors (mail, drive, …) in sessions (personal profile)
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
    "delegation_limit": 3,  # delegations working at once; the next ones wait as Queued
    "sandbox_read": [],  # extra home folders a delegation's test/build commands may read (toolchains); settings.json only
    "onboarded": False,
}
MODES = ("default", "auto", "plan")
MODELS = chain.MODELS
PROFILES = ("work", "personal")
STT = ("browser", "parakeet", "whisper")
WORK_OFF = {"brain": False, "connectors": False}  # what the work profile never turns on, whatever is saved
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
        if "profile" not in data and data.get("onboarded"):
            data["profile"] = "personal"  # set up before profiles: keeps working as it did
        self.data = {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}

    @property
    def work(self) -> bool:
        return self.data["profile"] != "personal"

    def __getitem__(self, key: str):
        """A setting as it applies now: the work profile keeps connectors off and speech on this Mac (the saved
        values stay, for a switch back to personal)."""
        if self.work and key in WORK_OFF:
            return WORK_OFF[key]
        if self.work and key == "stt" and self.data["stt"] == "browser":
            return "parakeet"
        return self.data[key]

    def view(self) -> dict:
        """The settings as they apply now, for the page."""
        return {k: self[k] for k in self.data}

    def update(self, changes: dict) -> dict:
        if "voice" in changes and isinstance(changes["voice"], str) and changes["voice"].strip():
            self.data["voice"] = changes["voice"].strip()
        if changes.get("default_mode") in MODES:
            self.data["default_mode"] = changes["default_mode"]
        if changes.get("default_model") in MODELS:
            self.data["default_model"] = changes["default_model"]
        if changes.get("coder_effort") in chain.CODER_EFFORTS:
            self.data["coder_effort"] = changes["coder_effort"]
        if changes.get("profile") in PROFILES:
            self.data["profile"] = changes["profile"]
        if changes.get("stt") in STT and not (self.work and changes["stt"] == "browser"):
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
        for key in ("brain", "connectors", "routines", "routines_judge", "onboarded"):
            if isinstance(changes.get(key), bool):
                self.data[key] = changes[key]
        self.save()
        return self.view()

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
