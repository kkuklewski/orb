"""Folders and their sessions, kept in ~/.orb/sessions.json.

Each folder can hold several sessions. A session has a local key (stable from the moment it is
created), the Claude session id to resume once Claude has assigned one, a label (its first
request) and timestamps. The folder remembers its active session and its approvals mode.

    {"version": 2, "folders": {"/path": {"active": "<key>", "permission_mode": "default",
        "added": false, "last_used": 0.0,
        "sessions": {"<key>": {"resume": "<claude id>", "label": "...", "created": 0.0, "last_used": 0.0}}}}}
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

NEW_LABEL = "New session"
LABEL_MAX = 60


class SessionStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            raw = {}
        self.data: dict[str, dict] = raw.get("folders", {}) if isinstance(raw, dict) else {}
        if raw.get("version") != 2:
            self._migrate()

    def _migrate(self) -> None:
        """v1 kept one session_id per folder."""
        for entry in self.data.values():
            sid = entry.pop("session_id", None)
            entry.setdefault("sessions", {})
            if sid and not entry["sessions"]:
                key = uuid.uuid4().hex
                ts = entry.get("last_used") or time.time()
                entry["sessions"][key] = {"resume": sid, "label": NEW_LABEL, "created": ts, "last_used": ts}
                entry["active"] = key

    # -- folders --------------------------------------------------------------------

    def _folder(self, folder: str) -> dict:
        entry = self.data.setdefault(folder, {})
        entry.setdefault("sessions", {})
        return entry

    def last_used(self, folder: str) -> float | None:
        return self.data.get(folder, {}).get("last_used")

    def mode(self, folder: str, default: str = "default") -> str:
        """Approvals mode for the folder's sessions; new folders start at the default from Settings."""
        return self.data.get(folder, {}).get("permission_mode", default)

    def pinned(self, folder: str) -> bool:
        return bool(self.data.get(folder, {}).get("pinned"))

    def set_pinned(self, folder: str, pinned: bool) -> None:
        self._folder(folder)["pinned"] = bool(pinned)
        self._save()

    def set_mode(self, folder: str, mode: str) -> None:
        self._folder(folder)["permission_mode"] = mode
        self._save()

    def model(self, folder: str, default: str = "sonnet") -> str:
        """Front model for the folder's sessions ("sonnet" / "opus"); new folders use the Settings default."""
        return self.data.get(folder, {}).get("model", default)

    def set_model(self, folder: str, model: str) -> None:
        self._folder(folder)["model"] = model
        self._save()

    def extra_folders(self) -> list[str]:
        """Folders added by path (or pinned) that the scan does not find."""
        return [f for f, e in self.data.items() if e.get("added") or e.get("pinned")]

    def add_folder(self, folder: str) -> None:
        self._folder(folder)["added"] = True
        self._save()

    # -- sessions -------------------------------------------------------------------

    def sessions(self, folder: str) -> list[dict]:
        """The folder's sessions, most recently used first."""
        items = [{"key": k, **v} for k, v in self.data.get(folder, {}).get("sessions", {}).items()]
        return sorted(items, key=lambda s: s.get("last_used") or 0, reverse=True)

    def active(self, folder: str) -> str | None:
        entry = self.data.get(folder, {})
        key = entry.get("active")
        return key if key in entry.get("sessions", {}) else None

    def new_session(self, folder: str) -> str:
        key = uuid.uuid4().hex
        now = time.time()
        entry = self._folder(folder)
        entry["sessions"][key] = {"resume": None, "label": NEW_LABEL, "created": now, "last_used": now}
        entry["active"] = key
        entry["last_used"] = now
        self._save()
        return key

    def open(self, folder: str, key: str | None = None) -> str:
        """Make key (or the active / most recent session, or a new one) active; return it."""
        entry = self._folder(folder)
        if key not in entry["sessions"]:
            key = self.active(folder) or next((s["key"] for s in self.sessions(folder)), None)
        if key is None:
            return self.new_session(folder)
        entry["active"] = key
        self.touch(folder, key)
        return key

    def touch(self, folder: str, key: str) -> None:
        now = time.time()
        entry = self._folder(folder)
        if key in entry["sessions"]:
            entry["sessions"][key]["last_used"] = now
        entry["last_used"] = now
        self._save()

    def resume_id(self, folder: str, key: str) -> str | None:
        return self.data.get(folder, {}).get("sessions", {}).get(key, {}).get("resume")

    def set_resume(self, folder: str, key: str, resume: str | None) -> None:
        s = self._folder(folder)["sessions"].get(key)
        if s is not None and s.get("resume") != resume:
            s["resume"] = resume
            self._save()

    def label_from_request(self, folder: str, key: str, text: str) -> None:
        """Label a session by its first request."""
        s = self._folder(folder)["sessions"].get(key)
        if s is not None and s.get("label") in (None, "", NEW_LABEL):
            text = " ".join(text.split())
            s["label"] = text[:LABEL_MAX] + ("…" if len(text) > LABEL_MAX else "")
            self._save()

    def backfill_labels(self, first_request) -> int:
        """Title sessions that predate titles: their first user message from the transcript
        (first_request(folder, resume) -> str | None), else the date and time. Returns the count."""
        changed = 0
        for folder, entry in self.data.items():
            for s in entry.get("sessions", {}).values():
                if s.get("label") not in (None, "", NEW_LABEL, "Earlier session") or not s.get("resume"):
                    continue
                try:
                    text = first_request(folder, s["resume"])
                except Exception:  # noqa: BLE001 - a missing transcript just falls back to the date
                    text = None
                if text:
                    text = " ".join(text.split())
                    s["label"] = text[:LABEL_MAX] + ("…" if len(text) > LABEL_MAX else "")
                else:
                    ts = s.get("created") or s.get("last_used") or time.time()
                    s["label"] = "Session " + time.strftime("%d %b %H:%M", time.localtime(ts))
                changed += 1
        if changed:
            self._save()
        return changed

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 2, "folders": self.data}, indent=2))
        os.replace(tmp, self.path)
