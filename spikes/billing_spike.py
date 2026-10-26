"""Milestone 1: does ClaudeSDKClient run on the Max login with no API key?

Run: uv run python spikes/billing_spike.py
"""

import asyncio
import json
import os
import tempfile

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    RateLimitEvent,
    ResultMessage,
    SystemMessage,
    TextBlock,
)

from orb.billing import FORBIDDEN_ENV, assert_subscription_env, sdk_env


async def main() -> None:
    assert_subscription_env()
    print("env check: none of", ", ".join(FORBIDDEN_ENV), "is set")
    opts = ClaudeAgentOptions(
        cwd=tempfile.mkdtemp(prefix="vd-spike-"),
        env=sdk_env(),
        max_turns=1,
        allowed_tools=[],
    )
    async with ClaudeSDKClient(options=opts) as client:
        await client.query("Reply with exactly: billing spike ok")
        async for msg in client.receive_response():
            if isinstance(msg, SystemMessage) and msg.subtype == "init":
                keys = ("apiKeySource", "model", "claude_code_version", "cwd", "permissionMode")
                print("init:", json.dumps({k: msg.data.get(k) for k in keys}))
            elif isinstance(msg, RateLimitEvent):
                print("rate_limit_event:", msg.rate_limit_info)
            elif isinstance(msg, AssistantMessage):
                print("assistant:", "".join(b.text for b in msg.content if isinstance(b, TextBlock)))
            elif isinstance(msg, ResultMessage):
                print("result:", msg.subtype, "is_error", msg.is_error, "cost_usd", msg.total_cost_usd)


if __name__ == "__main__":
    asyncio.run(main())
