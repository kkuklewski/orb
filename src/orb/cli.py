"""Start in CLI: a Home item (a task, a note's task, a pull request) becomes a background Claude Code session in its
repo, `claude --bg --name <title> -- "<brief>"`, the kind the `claude agents` view lists and `claude attach <id>` opens.
This is the default Start; a session in Orb's own page is the other button (settings "start_in").

The command is a fixed argv run without a shell: the brief is one argument after `--`, so nothing a tracker or GitHub
wrote in it can become a second command or an option, and the repo is only a path the server already allowed
(server.repo_of, or the notes folder). The CLI gets the server's environment through billing.clean_env (subscription
only, no key or other endpoint) plus the profile's connector switch (brain.connector_env: the work profile keeps the
claude.ai connectors off). It is Claude Code's own session from there: its permission prompts, not Orb's gate or
fence. The owner's click is the approval; nothing is stored."""

from __future__ import annotations

import asyncio
import contextlib
import re
import shutil

from . import billing

NAME_MAX = 60
TIMEOUT = 30  # seconds for `claude --bg` to start the session and print its id
FALLBACK_NAME = "Orb task"
# claude prints "backgrounded · <id> · <name>" and a "claude attach <id>" hint; the id is what follows "attach"
ID = re.compile(r"\bclaude attach\s+([A-Za-z0-9][\w.-]*)")
ID_LINE = re.compile(r"^backgrounded\s*[·:-]\s*([A-Za-z0-9][\w.-]*)", re.M)


def name_of(title: str) -> str:
    """One short line for `--name`: the item's title, whitespace squeezed."""
    one = " ".join((title or "").split())
    return one[:NAME_MAX].rstrip() or FALLBACK_NAME


def command(brief: str, title: str) -> list[str]:
    return ["claude", "--bg", "--name", name_of(title), "--", brief.strip()]


def env(connectors: dict[str, str] | None = None) -> dict[str, str]:
    """The CLI's environment: the server's without billing's forbidden variables, plus the connector switch."""
    return {**billing.clean_env(), **(connectors or {})}


async def start(repo: str, brief: str, title: str, connectors: dict[str, str] | None = None) -> dict:
    """Run `claude --bg` in `repo`: {'id', 'output', 'error'}; an error is a line to show, never an exception."""
    argv = command(brief, title)
    if not argv[-1]:
        return {"id": None, "output": "", "error": "Nothing to start: the brief is empty."}
    if shutil.which(argv[0]) is None:
        return {"id": None, "output": "", "error": "The claude command isn't on this server's PATH."}
    try:
        proc = await asyncio.create_subprocess_exec(*argv, cwd=repo, env=env(connectors), stdin=asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except OSError as e:
        return {"id": None, "output": "", "error": f"Could not run claude ({type(e).__name__})."}
    try:
        out, err = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()
        return {"id": None, "output": "",
                "error": f"claude --bg didn't answer within {TIMEOUT} s; check `claude agents` before starting it again."}
    output = out.decode(errors="replace").strip()
    if proc.returncode != 0:
        said = " ".join(err.decode(errors="replace").split()) or output or "no message"
        return {"id": None, "output": output, "error": f"claude exited with {proc.returncode}: {said[:300]}"}
    return {"id": session_id(output), "output": output, "error": None}


def session_id(output: str) -> str | None:
    """The session id in `claude --bg`'s output, from its `claude attach <id>` hint or its "backgrounded · <id>" line."""
    m = ID.search(output) or ID_LINE.search(output)
    return m.group(1) if m else None
