"""Onboarding checks: is Claude Code signed in, which folders Orb may open, what speech runs here.

Orb never handles credentials. Sign-in happens in Anthropic's own flow (`claude auth login` in a
terminal); here we only run `claude auth status --json` and keep three fields from it. The email,
organization and paths it also prints never leave this module.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

import claude_agent_sdk

from . import billing, folders, parakeet, speech
from .settings import settings

# Folders people often keep their code in; the onboarding offers the ones that exist.
SUGGESTED = ("_Development", "Developer", "Development", "dev", "code", "Code", "src", "Projects", "projects",
             "repos", "workspace", "GitHub", "git")
AUTH_TIMEOUT = 20


def claude_binary() -> str | None:
    """The Claude Code the Agent SDK runs: its bundled copy, else `claude` on PATH."""
    bundled = Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude"
    return str(bundled) if bundled.is_file() else shutil.which("claude")


async def auth_status() -> dict:
    """{'installed', 'loggedIn', 'subscription', 'method', 'error'}; never the account details."""
    binary = claude_binary()
    if binary is None:
        return {"installed": False, "loggedIn": False, "subscription": None, "method": None,
                "error": "Claude Code was not found."}
    try:
        proc = await asyncio.create_subprocess_exec(
            binary, "auth", "status", "--json", env={**os.environ, **billing.sdk_env()},  # API keys blanked
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(proc.communicate(), AUTH_TIMEOUT)
        data = json.loads(out or b"{}")
    except (OSError, ValueError, asyncio.TimeoutError) as e:
        return {"installed": True, "loggedIn": False, "subscription": None, "method": None,
                "error": f"Could not ask Claude Code: {type(e).__name__}"}
    method = data.get("authMethod")
    return {"installed": True, "loggedIn": bool(data.get("loggedIn")),
            "subscription": data.get("subscriptionType") if isinstance(data.get("subscriptionType"), str) else None,
            "method": method if isinstance(method, str) else None,
            # Orb runs on a subscription only (billing.py): a Console/API-key login is not enough.
            "subscriptionLogin": method == "claude.ai", "error": None}


def _repos(root: Path) -> list[str]:
    return [f.rel for f in folders.discover(root)][:200]


def suggestions() -> list[dict]:
    """Existing code folders under the home folder, with how many repos each holds."""
    home = Path.home()
    out = []
    for name in SUGGESTED:
        p = home / name
        if p.is_dir() and not p.is_symlink():
            out.append({"path": str(p), "repos": len(_repos(p))})
    return [s for s in out if s["repos"]]


async def status() -> dict:
    """Everything the onboarding page shows, in one event."""
    auth, health = await asyncio.gather(auth_status(), speech.health())
    roots = await asyncio.to_thread(lambda: [{"path": str(r), "exists": r.is_dir(), "repos": _repos(r) if r.is_dir() else []}
                                             for r in settings.roots()])
    on_path = shutil.which("claude")
    return {
        "type": "setup_status",
        "auth": auth,
        # Sign-in goes through Claude Code's own command; the copy that comes with Orb works when
        # Claude Code isn't installed separately (both use the same login).
        "login_cmd": "claude auth login" if on_path else f"'{claude_binary()}' auth login",
        "roots": roots,
        "suggested": [s for s in await asyncio.to_thread(suggestions) if s["path"] not in settings["roots"]],
        "home": str(Path.home()),
        "speech": {**health, "parakeet": parakeet.MODEL.is_file() and parakeet.LIB.is_file()},
        "values": {k: settings[k] for k in ("stt", "tts", "skip_names", "onboarded")},
    }


# -- folder picking (the page can't read real paths from the browser's own picker) -----------------

BROWSE_LIMIT = 300


def browse(raw: str | None) -> dict:
    """Subfolders of a folder in the home folder (or on /Volumes), for the setup's folder browser.
    Hidden folders, skipped names (secrets/, node_modules, ...) and symlinks are left out."""
    home = Path.home().resolve()
    try:
        p = Path(raw).expanduser().resolve() if raw else home
    except (OSError, RuntimeError):
        p = home
    allowed = (home, Path("/Volumes"))
    if not p.is_dir() or not any(p == a or a in p.parents for a in allowed):
        p = home
    skip = folders.skip_names()
    entries = []
    try:
        for e in sorted(os.scandir(p), key=lambda e: e.name.casefold()):
            if e.name.startswith(".") or e.name in skip or not e.is_dir(follow_symlinks=False):
                continue
            entries.append({"name": e.name, "path": e.path, "repo": os.path.exists(os.path.join(e.path, ".git"))})
            if len(entries) >= BROWSE_LIMIT:
                break
    except OSError:
        pass
    parent = p.parent if p != home and p != Path("/Volumes") else None
    return {"type": "browse", "path": str(p), "home": str(home), "parent": str(parent) if parent else None,
            "repo": (p / ".git").exists(), "entries": entries, "truncated": len(entries) >= BROWSE_LIMIT}


async def pick_native() -> dict:
    """The system folder dialog (macOS: Finder's "Choose a folder"). {'path'} or {'error'}."""
    if sys.platform != "darwin":
        return {"type": "picked", "error": "The system folder dialog is only on macOS here; use Browse."}
    script = ('tell application "System Events" to activate\n'
              'POSIX path of (choose folder with prompt "Choose a folder Orb may open")')
    try:
        proc = await asyncio.create_subprocess_exec("osascript", "-e", script,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), 300)
    except (OSError, asyncio.TimeoutError) as e:
        return {"type": "picked", "error": f"Could not open the folder dialog ({type(e).__name__})."}
    if proc.returncode != 0:
        text = err.decode(errors="replace")
        return {"type": "picked", "error": None if "-128" in text else "The folder dialog failed; use Browse.",
                "cancelled": "-128" in text}
    path = out.decode().strip().rstrip("/") or None
    return {"type": "picked", "path": path}
