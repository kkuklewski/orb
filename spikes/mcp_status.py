"""Round 3 / 1a: which MCP servers does a dashboard session see in a folder? No query is sent.

uv run python spikes/mcp_status.py <folder>
"""
import asyncio
import sys

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

from orb.billing import assert_subscription_env, sdk_env


async def main(folder: str) -> None:
    assert_subscription_env()
    opts = ClaudeAgentOptions(cwd=folder, env=sdk_env(), permission_mode="default")
    async with ClaudeSDKClient(options=opts) as client:
        await asyncio.sleep(8)  # let servers connect
        st = await client.get_mcp_status()
        for s in st.get("mcpServers", []):
            tools = s.get("tools") or []
            print(f"{s['status']:<11} {s['name']:<40} tools={len(tools)}", ", ".join(t.get("name", "") for t in tools)[:160])


asyncio.run(main(sys.argv[1]))
