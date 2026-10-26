from pathlib import Path

import pytest

from orb import grant as grants
from orb import trust, worktree
from orb.fence import Fence, strictest
from orb.grant import decide


@pytest.fixture
def dev(tmp_path):
    (tmp_path / "web" / ".git").mkdir(parents=True)
    return tmp_path


def test_settings_load_only_when_trusted_and_never_in_a_worktree(dev, monkeypatch):
    web = str(dev / "web")
    assert trust.sources(web, trusted=False) == ["user"]
    assert trust.sources(web, trusted=True) == ["user", "project", "local"]
    monkeypatch.setattr(worktree, "registered", lambda: {web: str(dev / "repo")})
    assert trust.sources(web, trusted=True) == ["user"]


def test_instructions_carry_the_repo_and_parent_claude_md(dev):
    (dev / "CLAUDE.md").write_text("Workspace rule: acme folders are client work.")
    (dev / "web" / "CLAUDE.md").write_text("Run uv run pytest.")
    (dev / "web" / ".claude" / "rules").mkdir(parents=True)
    (dev / "web" / ".claude" / "rules" / "style.md").write_text("Short names.")
    (dev / "web" / "CLAUDE.local.md").symlink_to(dev / "CLAUDE.md")  # a symlink is skipped
    text = trust.instructions(str(dev / "web"))
    assert text.index("Workspace rule") < text.index("Run uv run pytest.") < text.index("Short names.")
    assert text.count("Workspace rule") == 1
    assert "settings are not loaded" in text


def test_instructions_are_empty_without_files(dev):
    assert trust.instructions(str(dev / "web")) == ""


def test_instructions_cap_each_file(dev):
    (dev / "web" / "CLAUDE.md").write_text("x" * (trust.FILE_MAX + 500))
    text = trust.instructions(str(dev / "web"))
    assert "x" * trust.FILE_MAX in text and "x" * (trust.FILE_MAX + 1) not in text


@pytest.mark.parametrize("path, runs", [
    ("web/.claude/settings.json", True),
    ("web/.claude/settings.local.json", True),
    ("web/.claude/hooks/start.sh", True),
    ("web/.claude/skills/x/SKILL.md", True),
    ("web/.claude/commands/ship.md", True),
    ("web/.mcp.json", True),
    ("web/.git/hooks/pre-commit", True),
    ("web/.git/config", True),
    ("web/CLAUDE.md", False),
    ("web/.claude/CLAUDE.md", False),
    ("web/.claude/rules/style.md", False),
    ("home/.claude/projects/web/memory/a.md", False),
    ("web/src/settings.json", False),
])
def test_runs_code(path, runs):
    assert trust.runs_code(path) is runs


def fence(dev: Path) -> Fence:
    return Fence(str(dev / "web"), root=dev, clients=(), vault=None, never=set())


def test_the_fence_cards_run_config_writes_even_under_a_grant(dev):
    f = fence(dev)
    g = grants.for_repo(f, str(dev / "web"), "orb/x", False, ["uv run pytest -q"])
    gate = lambda tool, inp: decide(strictest(f.rule(tool, inp)), g, tool, inp)  # noqa: E731
    assert gate("Write", {"file_path": str(dev / "web" / ".claude" / "settings.json")}) == "card"
    assert gate("Edit", {"file_path": ".mcp.json"}) == "card"
    assert gate("Edit", {"file_path": str(dev / "web" / "CLAUDE.md")}) == "allow"
    assert gate("Edit", {"file_path": str(dev / "web" / "src" / "a.py")}) == "allow"
    assert f.rule("Read", {"file_path": str(dev / "web" / ".claude" / "settings.json")}) == {}
    reason = strictest(f.rule("Write", {"file_path": ".claude/hooks/x.sh"}))["hookSpecificOutput"]
    assert reason["permissionDecision"] == "ask" and "runs without a card" in reason["permissionDecisionReason"]
