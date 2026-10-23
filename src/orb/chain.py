"""The agent chain: a fast front model that talks and routes, Opus as a subagent for hard coding.

The front is per folder (Sonnet by default; Haiku is the cheapest, for notes and status; Opus for a
heavy-coding repo); the header chip and "switch to Opus" / "przełącz na Opus" change it. Hard coding goes to the `opus-coder` subagent,
in the background by default, so the user can keep talking while it works.
"""

from __future__ import annotations

import re

from claude_agent_sdk import AgentDefinition

from . import config

MODELS = ("haiku", "sonnet", "opus")
# Reasoning effort per front model. None keeps the CLI default (what Opus ran with before; Haiku has no effort).
EFFORT = {"haiku": None, "sonnet": config.env("SONNET_EFFORT", "low"), "opus": None}
CODER = "opus-coder"
CODER_MAX_TURNS = 80  # runaway guard
CODER_EFFORTS = ("low", "medium", "high")  # Settings; "high" burns the plan fastest, so it isn't the default
DEFAULT_CODER_EFFORT = "medium"


def agents(coder_effort: str = DEFAULT_CODER_EFFORT) -> dict:
    """The subagents for a session; the coder's effort is the user's setting."""
    effort = coder_effort if coder_effort in CODER_EFFORTS else DEFAULT_CODER_EFFORT
    return {CODER: _coder(effort)}


def _coder(effort: str) -> AgentDefinition:
    return AgentDefinition(
        description=(
            "Hard coding work: changes across several files, failing tests or debugging, architecture, "
            "performance, security-sensitive code, anything that needs careful reasoning."
        ),
        prompt=(
            "You are a senior engineer. A voice session handed you a hard coding task. Work carefully: "
            "read the code first, make the change, run the relevant tests. You cannot ask the user "
            "questions; if something is ambiguous, pick the safest reading and say so. Finish with a short "
            "report for the voice session: what you changed (files), what you ran and its result, and "
            "anything left open. Plain Markdown, no <spoken> tags."
        ),
        model="opus",
        effort=effort,
        maxTurns=CODER_MAX_TURNS,
    )


ROUTING_PROMPT = f"""\
# Agent chain
You are the front of a chain: answer fast, and hand hard coding to the `{CODER}` subagent (Opus).
- Answer yourself: conversation, questions, status checks, second-brain actions, reading code, and
  small single-file edits.
- Delegate to `{CODER}` with the Agent tool: changes across several files, failing tests or debugging,
  architecture, performance, security-sensitive code, anything that needs careful reasoning. Also when
  the user says "use Opus", "think hard" or "użyj Opus".
- Run it in the background (the default) and say one spoken line, e.g. "Handing this to Opus, I'll tell
  you when it's done." When he says "wait for it" / "poczekaj na to", run it in the foreground
  (run_in_background: false).
- The subagent can't ask questions: if the task is ambiguous, ask the user first, then delegate with a
  complete brief (goal, files, constraints, how to verify).
- When it reports back, summarize the result in <spoken> and put the details in the written part.
  Orb has already said "Opus is done", so start with the result, not with that.
- If you are already running as Opus, do the work yourself instead of delegating.
"""

_NAME = r"(opus|sonnet|sonet|haiku)"
SWITCH_TRIGGER = re.compile(
    rf"^\s*(?:(?:please\s+)?(?:switch|change|go)\s+(?:back\s+)?to\s+{_NAME}"
    rf"|przełącz(?:\s+się)?\s+na\s+{_NAME}|zmień\s+na\s+{_NAME})[\s.!]*$",
    re.IGNORECASE,
)


def switch_request(text: str) -> str | None:
    """"Switch to Opus" -> "opus"; anything else -> None."""
    m = SWITCH_TRIGGER.match(text)
    if not m:
        return None
    name = next(g for g in m.groups() if g).lower()
    return "sonnet" if name.startswith("son") else "haiku" if name == "haiku" else "opus"


HAIKU_PROMPT = f"""\
# You are the cheapest front model (Haiku)
Keep your own work to conversation, questions, status checks, second-brain actions and reading. For
ANY change to code or files beyond a one-line fix, and for debugging, delegate to `{CODER}` right away
with a complete brief; don't try it yourself. If a question needs deep reasoning, say so and offer to
switch to Sonnet or Opus ("switch to Sonnet").
"""


def routing_prompt(model: str) -> str:
    return ROUTING_PROMPT + (HAIKU_PROMPT if model == "haiku" else "")


def is_coder_call(name: str, inp: dict) -> bool:
    return name in ("Agent", "Task") and inp.get("subagent_type") == CODER
