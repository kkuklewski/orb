"""Billing guard: the dashboard must run on the Max subscription login, never API credit.

The Agent SDK spawns Claude Code with the server's environment merged in, and Claude Code
prefers an API key over the `claude` login. So the server refuses to start when a key is
present, and the init message of every session is checked for its auth source.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

# Any of these makes Claude Code bill something other than the subscription login.
FORBIDDEN_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
)

# apiKeySource values from the init message that mean "no API key, using the login".
SUBSCRIPTION_SOURCES = {"none"}


class BillingError(RuntimeError):
    pass


def forbidden_vars(env: Mapping[str, str]) -> list[str]:
    """Names of forbidden variables that are set (non-empty) in env."""
    return [k for k in FORBIDDEN_ENV if env.get(k)]


def assert_subscription_env(env: Mapping[str, str] | None = None) -> None:
    """Raise BillingError if the environment would bill the API instead of the plan."""
    found = forbidden_vars(os.environ if env is None else env)
    if found:
        raise BillingError(
            f"Refusing to start: {', '.join(found)} is set. The dashboard bills the Max "
            "subscription through the `claude` login; unset it and start again."
        )


def clean_env(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """A copy of env without the forbidden variables."""
    src = os.environ if env is None else env
    return {k: v for k, v in src.items() if k not in FORBIDDEN_ENV}


def sdk_env() -> dict[str, str]:
    """The `env` passed to ClaudeAgentOptions.

    The SDK merges os.environ underneath options.env, so it cannot remove variables;
    re-checking os.environ here catches a key set after startup. Blank overrides make
    sure nothing slips through even then.
    """
    assert_subscription_env()
    return {k: "" for k in FORBIDDEN_ENV}


def check_init(data: Mapping[str, object]) -> str:
    """Check a session's init message; return its apiKeySource or raise BillingError."""
    source = str(data.get("apiKeySource", ""))
    if source not in SUBSCRIPTION_SOURCES:
        raise BillingError(
            f"Session reports apiKeySource={source!r}, not the subscription login. Stopped."
        )
    return source
