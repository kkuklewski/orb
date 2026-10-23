from pathlib import Path

import pytest

from orb.fence import Fence, glob_may_hit_secret, is_secret_name, read_only_bash, strictest
from orb.brain import ask, deny


def decision(out: dict) -> str | None:
    return out.get("hookSpecificOutput", {}).get("permissionDecision")


@pytest.fixture
def dev(tmp_path):
    for d in ("vault/.git", "mine/.git", "other/.git", "secrets", "acme/portal/app/.git", "acme/site/.git", "globex/.git"):
        (tmp_path / d).mkdir(parents=True)
    return tmp_path


def fence(dev: Path, session: str) -> Fence:
    return Fence(str(dev / session), root=dev, clients=("acme", "globex"), vault=dev / "vault")


def test_own_repo_and_outside_workspace_pass(dev):
    f = fence(dev, "mine")
    assert f.rule("Read", {"file_path": str(dev / "mine" / "a.py")}) == {}
    assert f.rule("Edit", {"file_path": "src/x.py"}) == {}
    assert f.rule("Read", {"file_path": "/tmp/out.txt"}) == {}
    assert f.rule("Bash", {"command": "uv run pytest tests/ && git push origin main"}) == {}
    assert f.rule("Bash", {"command": 'git commit -m "$(cat <<\'EOF\'\nfix: keep secrets/ and .env out\nEOF\n)"'}) == {}


def test_secrets_always_blocked(dev):
    f = fence(dev, "mine")
    assert decision(f.rule("Read", {"file_path": str(dev / "secrets" / "x.json")})) == "deny"
    assert decision(f.rule("Bash", {"command": "cat ../secrets/x.json"})) == "deny"
    assert decision(f.rule("Bash", {"command": "cd .. && cat secrets/x.json"})) == "deny"
    assert decision(f.rule("Bash", {"command": "ls ../Secrets"})) == "deny"
    assert decision(f.rule("Read", {"file_path": ".env"})) == "deny"
    assert decision(f.rule("Bash", {"command": "set -a; source .env.local; npm run dev"})) == "deny"
    assert decision(f.rule("Bash", {"command": "node --env-file=.env app.js"})) == "deny"
    assert decision(f.rule("Grep", {"pattern": "x", "path": str(dev / "secrets")})) == "deny"
    assert decision(f.rule("Glob", {"pattern": "~/.aws/*"})) == "deny"


def test_secret_names():
    assert is_secret_name(".env") and is_secret_name(".env.production") and is_secret_name("server.pem")
    assert is_secret_name("id_ed25519.pub") and is_secret_name("credentials.json")
    assert not is_secret_name(".env.example") and not is_secret_name(".key") and not is_secret_name(".venv")


def test_client_folders_only_from_inside(dev):
    f = fence(dev, "mine")
    assert decision(f.rule("Read", {"file_path": str(dev / "acme" / "portal" / "app" / "a.ts")})) == "deny"
    assert decision(f.rule("Bash", {"command": "git -C ../acme/portal/app log"})) == "deny"
    assert decision(f.rule("Bash", {"command": "cd ..; cd globex && ls"})) == "deny"
    assert decision(f.rule("Glob", {"pattern": "../acm*/**/*.ts"})) == "deny"
    inside = fence(dev, "acme/portal/app")
    assert inside.rule("Read", {"file_path": str(dev / "acme" / "portal" / "app" / "a.ts")}) == {}
    assert decision(inside.rule("Read", {"file_path": str(dev / "acme" / "site" / "a.ts")})) == "ask"
    assert decision(inside.rule("Read", {"file_path": str(dev / "globex" / "a.ts")})) == "deny"


def test_other_repos_need_a_card_that_says_where(dev):
    f = fence(dev, "mine")
    out = f.rule("Edit", {"file_path": str(dev / "other" / "README.md")})
    assert decision(out) == "ask"
    assert f.reason("Edit", {"file_path": str(dev / "other" / "README.md")}) == "Other repo: other. This session is in mine."
    assert decision(f.rule("Bash", {"command": "cat ../other/README.md"})) == "ask"
    assert decision(f.rule("Bash", {"command": "cd .. && ls"})) == "ask"


def test_strictest():
    assert decision(strictest({}, ask("a"))) == "ask"
    assert decision(strictest(ask("a"), deny("b"))) == "deny"
    assert strictest({}, {}) == {}


def test_vault_session_reads_client_repos_with_a_card_but_never_changes_them(dev):
    hub = fence(dev, "vault")
    app = dev / "acme" / "portal" / "app"
    assert hub.reason("Read", {"file_path": str(app / "README.md")}) == "Client repo: app."
    assert decision(hub.rule("Grep", {"pattern": "x", "path": str(app)})) == "ask"
    assert decision(hub.rule("Bash", {"command": f"git -C {app} log --oneline -20 && ls {app}"})) == "ask"
    assert decision(hub.rule("Edit", {"file_path": str(app / "README.md")})) == "deny"
    assert decision(hub.rule("Bash", {"command": f"cd {app} && git commit -am x"})) == "deny"
    assert decision(hub.rule("Bash", {"command": f"cat {app}/a > /tmp/b"})) == "deny"
    assert decision(hub.rule("Read", {"file_path": str(dev / "secrets" / "x")})) == "deny"
    assert decision(hub.rule("Read", {"file_path": str(dev / "other" / "a.md")})) == "ask"


def test_read_only_bash():
    assert read_only_bash("git -C ../x log --oneline && ls -la | head")
    assert read_only_bash("git branch -a; git remote -v; grep -rn foo src")
    assert read_only_bash("git --no-pager log --oneline -20 --stat && find src -name '*.py' -type f | head -n 5")
    assert read_only_bash('grep -rn --include="*.ts" "a b" src/*.ts && find . -name "*.py"')
    for cmd in ("git branch new", "git -c core.pager=x log", "git diff --output=f", "find . -delete",
                "ls #\nrm -rf x", "ls # x\nrm x", "ls\rrm x",
                "sort -o f a", "echo x > f", "cat $(ls)", "npm test", "sed -i s/a/b/ f",
                "cat a & rm b", "cat a &rm b", "rg --pre ./x foo", "find . -fls out", "sort -uo f a", "tree -o f",
                "find . -name *", "git log --ou*", "cat *", "grep -rn --include=*.ts x .",
                "git branch -D x", "git branch --unset-upstream", "git tag -d v1", "git diff --ext-diff",
                "(rm a)", "cat a\\\nrm b", 'find . -"delete"', "rg foo", "uniq a b", "jq . a",
                "git -c x=y log", "git --exec-path=/x log", "git log --outp=f", "git diff --ext", "git --git-dir=x log",
                "ls --hostname-bin=x", "grep --pre=x foo", "cat a\nrm b"):
        assert not read_only_bash(cmd), cmd


def test_searches_cannot_reach_secrets(dev):
    f = fence(dev, "mine")
    assert decision(f.rule("Grep", {"pattern": "KEY", "glob": ".env*"})) == "deny"
    assert decision(f.rule("Grep", {"pattern": "KEY", "glob": "*.{pem,ts}"})) == "deny"
    assert f.rule("Grep", {"pattern": "KEY", "glob": "*.ts"}) == {}
    assert decision(f.rule("Grep", {"pattern": "KEY", "path": ".."})) == "deny"
    assert decision(f.rule("Bash", {"command": "cd .. && grep -r KEY ."})) == "deny"
    assert decision(f.rule("Glob", {"pattern": "sub/../../secrets/*"})) == "deny"
    assert decision(f.rule("Bash", {"command": "rg KEY ~"})) == "deny"
    assert decision(f.rule("Bash", {"command": "ls .."})) == "ask"  # names only, not a search


def test_shell_globs_are_expanded_before_checking(dev):
    (dev / "mine" / ".env").write_text("K=1")
    (dev / "mine" / "server.pem").write_text("x")
    f = fence(dev, "mine")
    assert decision(f.rule("Bash", {"command": "cat .e*"})) == "deny"
    assert decision(f.rule("Bash", {"command": "cat *"})) == "deny"
    assert f.rule("Bash", {"command": "ls src/*.py"}) == {}
    assert glob_may_hit_secret("*") and not glob_may_hit_secret("*.md")


def test_notes_folder_outside_the_roots(tmp_path):
    code, notes = tmp_path / "code", tmp_path / "Documents" / "Notes"
    for d in (code / "app/.git", notes / "secrets", notes / "inbox"):
        d.mkdir(parents=True)
    f = Fence(str(notes), roots=[code], clients=(), vault=notes)
    assert f.rule("Read", {"file_path": str(notes / "inbox" / "today.md")}) == {}
    assert decision(f.rule("Read", {"file_path": str(notes / "secrets" / "bank.md")})) == "deny"
    coder = Fence(str(code / "app"), roots=[code], clients=(), vault=notes)
    out = coder.rule("Read", {"file_path": str(notes / "inbox" / "today.md")})
    assert decision(out) == "ask" and "Other repo: Notes" in out["hookSpecificOutput"]["permissionDecisionReason"]
