"""One-click Kokoro: VoiceMode installs and runs it, Orb keeps it on this Mac.

VoiceMode's Kokoro start scripts listen on every interface (`--host 0.0.0.0`), so anyone on the same network or
tailnet could use it. Orb rewrites that to 127.0.0.1 before Kokoro first starts, and looks again on every setup
status: a VoiceMode reinstall puts the scripts back. The page starts the job with one click (the click is the
approval); the commands are fixed and nothing from the page reaches them. macOS only (launchd).
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

STEP_TIMEOUT = 30 * 60  # the Kokoro install downloads PyTorch and the model
OPEN, LOCAL = "--host 0.0.0.0", "--host 127.0.0.1"

_job: dict | None = None  # {"step", "running", "error"} of the last one-click run, for the page
_task: asyncio.Task | None = None


def _dir() -> Path:
    return Path.home() / ".voicemode" / "services" / "kokoro"


def _plist() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / "com.voicemode.kokoro.plist"


def voicemode() -> str | None:
    """The `voicemode` command: on PATH, else where `uv tool install` puts it."""
    local = Path.home() / ".local" / "bin" / "voicemode"
    return shutil.which("voicemode") or (str(local) if local.is_file() else None)


def _scripts() -> list[Path]:
    return [p for p in sorted(_dir().glob("start-*.sh")) if p.is_file() and not p.is_symlink()]


def exposed() -> bool:
    """A Kokoro start script listens on every interface."""
    return any(OPEN in p.read_text(errors="replace") for p in _scripts())


def keep_local() -> int:
    """Kokoro's start scripts listen on 127.0.0.1 only; how many were changed."""
    changed = 0
    for p in _scripts():
        text = p.read_text(errors="replace")
        if OPEN in text:
            p.write_text(text.replace(OPEN, LOCAL))
            changed += 1
    return changed


def status() -> dict | None:
    """How far Kokoro is set up (running is `speech.kokoro`); None where the one-click setup doesn't apply."""
    if sys.platform != "darwin":
        return None
    return {"voicemode": voicemode() is not None, "installed": _dir().is_dir(), "autostart": _plist().is_file(),
            "exposed": exposed(), "job": dict(_job) if _job else None}


async def _run(*cmd: str, env: dict | None = None) -> str:
    """Runs a fixed command; VoiceMode reports failures with a ❌ line and exit 0, so both count."""
    proc = await asyncio.create_subprocess_exec(*cmd, env=env, stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), STEP_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"`{' '.join(cmd[1:])}` took longer than {STEP_TIMEOUT // 60} minutes.") from None
    text = out.decode(errors="replace")
    failed = [ln.strip() for ln in text.splitlines() if "❌" in ln]
    if proc.returncode or failed:
        last = (failed or [ln.strip() for ln in text.splitlines() if ln.strip()] or [f"exit {proc.returncode}"])[-1]
        raise RuntimeError(last[:300])
    return text


def _step(text: str) -> None:
    assert _job is not None
    _job["step"] = text


async def _setup() -> None:
    vm = voicemode()
    if vm is None:
        uv = shutil.which("uv")
        if uv is None:
            raise RuntimeError("uv was not found; install it from docs.astral.sh/uv, then try again.")
        _step("Installing VoiceMode")
        await _run(uv, "tool", "install", "voice-mode")
        vm = voicemode()
        if vm is None:
            raise RuntimeError("VoiceMode installed, but its `voicemode` command was not found.")
    if not _scripts():
        _step("Installing Kokoro and its voices (a few minutes)")
        # Not started yet: it would listen on every interface until keep_local.
        await _run(vm, "service", "install", "kokoro", env={**os.environ, "VOICEMODE_SERVICE_AUTO_ENABLE": "false"})
        if not _scripts():
            raise RuntimeError("The Kokoro install finished without its start script.")
    _step("Keeping it on this Mac")
    keep_local()
    if exposed():
        raise RuntimeError(f"Could not change Kokoro's start scripts in {_dir()}.")
    if _plist().is_file():
        _step("Restarting it")
        await _run(vm, "service", "restart", "kokoro")
    else:
        _step("Starting it, and at every login")
        await _run(vm, "service", "enable", "kokoro")
    _step("Starting (the first start downloads the voice model)")


async def _main() -> None:
    global _job
    try:
        await _setup()
        _job = {**_job, "running": False}
    except Exception as e:  # shown on the card, the owner can try again
        _job = {**_job, "running": False, "error": str(e) or type(e).__name__}


def start() -> bool:
    """Starts the one-click setup in the background; False if one is already running or this isn't a Mac."""
    global _job, _task
    if sys.platform != "darwin" or (_task is not None and not _task.done()):
        return False
    _job = {"step": "Starting", "running": True, "error": None}
    _task = asyncio.create_task(_main())
    return True
