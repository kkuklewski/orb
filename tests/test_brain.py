from pathlib import Path

import pytest

from orb import brain
from orb.brain import CaptureGuard, split_note, vault_rule


@pytest.mark.parametrize("text, note", [
    ("Zanotuj: kupić mleko i sprawdzić Coolify.", "kupić mleko i sprawdzić Coolify."),
    ("zanotuj to, że deploy jest w piątek", "że deploy jest w piątek"),
    ("Note this: the echo test is still open.", "the echo test is still open."),
    ("Note this down - call Globex tomorrow", "call Globex tomorrow"),
    ("Zapisz do mózgu: pomysł na dashboard", "pomysł na dashboard"),
    ("Take a note. Ask about the invoice.", "Ask about the invoice."),
])
def test_note_trigger_keeps_the_exact_words(text, note):
    assert split_note(text) == note


@pytest.mark.parametrize("text", ["What's new in my brain?", "Co nowego w mózgu?", "Zanotuj", "I noted that already", "Notation is fine"])
def test_no_note_without_trigger_and_text(text):
    assert split_note(text) is None


def guard(tmp_path):
    return CaptureGuard(tmp_path / "captures.json")


def decision(out):
    return out.get("hookSpecificOutput", {}).get("permissionDecision")


def test_thought_uses_the_queued_words_not_the_models(tmp_path):
    g = guard(tmp_path)
    g.queue("s1", "kupić mleko")
    out = g.pre_capture("s1", {"kind": "thought", "text": "The user wants to buy milk (rewritten)"})
    assert decision(out) == "allow"
    assert out["hookSpecificOutput"]["updatedInput"] == {"kind": "thought", "text": "kupić mleko"}


def test_ai_text_is_never_a_thought(tmp_path):
    out = guard(tmp_path).pre_capture("s1", {"kind": "thought", "text": "My summary of the call"})
    assert decision(out) == "deny" and "talk_summary" in out["hookSpecificOutput"]["permissionDecisionReason"]


def test_talk_summary_goes_through_normal_approval(tmp_path):
    assert guard(tmp_path).pre_capture("s1", {"kind": "talk_summary", "text": "Summary"}) == {}


def test_limits_4kb_and_20_a_day(tmp_path):
    g = guard(tmp_path)
    assert "limit is 4096" in g.refuse("x" * 4097)
    assert g.refuse("x" * 4096) is None
    for _ in range(brain.DAILY_LIMIT):
        g.record()
    assert "limit of 20" in g.refuse("short")
    g.queue("s1", "short")
    assert decision(g.pre_capture("s1", {"kind": "thought"})) == "deny"
    assert CaptureGuard(tmp_path / "captures.json").count() == 20  # survives a restart


def test_vault_rules(tmp_path):
    vault = tmp_path / "brain"
    for d in ("context", "inbox"):
        (vault / d).mkdir(parents=True)
    kept = ("context",)
    assert decision(vault_rule(vault, "Edit", {"file_path": str(vault / "context" / "priorities.md")}, protected=kept)) == "ask"
    assert decision(vault_rule(vault, "Edit", {"file_path": str(vault / "context" / "priorities.md")})) is None
    assert decision(vault_rule(vault, "Write", {"file_path": str(vault / "CLAUDE.md")})) == "ask"
    assert decision(vault_rule(vault, "Write", {"file_path": str(vault / "inbox" / "n.md")}, protected=kept)) is None
    assert decision(vault_rule(vault, "Edit", {"file_path": str(tmp_path / "other" / "context" / "x.md")}, protected=kept)) is None
    assert vault_rule(None, "Bash", {"command": "git push --force"}) == {}  # no vault set up: no vault rules
    assert decision(vault_rule(vault, "Bash", {"command": "git push --force origin main"}, cwd=str(vault))) == "deny"
    assert decision(vault_rule(vault, "Bash", {"command": "git pull --rebase && git push"})) is None


def test_vault_rules_resist_case_and_relative_paths(tmp_path):
    vault = tmp_path / "brain"
    (vault / "context").mkdir(parents=True)
    assert decision(vault_rule(vault, "Edit", {"file_path": str(vault / "Context" / "x.md")}, protected=("context",))) == "ask"
    assert decision(vault_rule(vault, "Write", {"file_path": str(vault / "claude.MD")})) == "ask"
    assert decision(vault_rule(vault, "Edit", {"file_path": "context/priorities.md"}, cwd=str(vault),
                               protected=("context",))) == "ask"
    assert decision(vault_rule(vault, "Edit", {"file_path": "notes/a.md"}, cwd=str(vault), protected=("context",))) is None


@pytest.mark.parametrize("cmd", [
    "git push -f", "git push -fu origin main", "git push origin +main", "git -C ~/x push --force-with-lease",
    "cd brain && git push --force", "git push origin main --force",
])
def test_force_push_variants_are_denied(tmp_path, cmd):
    assert decision(vault_rule(tmp_path, "Bash", {"command": cmd}, cwd=str(tmp_path))) == "deny"


@pytest.mark.parametrize("cmd", ["git push -f", "bash -c 'git push --force'", "eval \"git push -f origin main\"",
                                 "sh -c \"cd $V && git push origin +main\""])
def test_force_push_is_denied_in_every_folder_and_through_wrappers(tmp_path, cmd):
    assert decision(vault_rule(tmp_path / "brain", "Bash", {"command": cmd}, cwd=str(tmp_path / "other"))) == "deny"


@pytest.mark.parametrize("cmd", ["git push --mirror", "git push origin --delete old", "git push origin :old",
                                 "git push --prune origin", "git push -d origin x", "git -c remote.origin.push=+x push",
                                 "bash -c 'git push origin main'", "git push $(echo origin)", "git push 'unterminated",
                                 "git config remote.origin.mirror true && git push", "GIT_CONFIG_COUNT=1 git push",
                                 "g=git; $g push origin x:y", "\\git push --mirror", "git pu\\sh origin main --prune",
                                 "docker push img:1"])
def test_ref_deleting_pushes_need_a_card(tmp_path, cmd):
    assert decision(vault_rule(tmp_path, "Bash", {"command": cmd})) == "ask"


@pytest.mark.parametrize("cmd", ["git push", "git push -u origin main", "git pull --rebase && git push", "git fetch -f",
                                 "git push --tags", "git push origin feature/x"])
def test_normal_pushes_pass(tmp_path, cmd):
    assert decision(vault_rule(tmp_path, "Bash", {"command": cmd}, cwd=str(tmp_path))) is None



@pytest.mark.parametrize("cmd", ["G=git; $G push", "git push $REMOTE", "`which git` push", "git log | xargs git push",
                                 "git commit -m \"$(cat msg)\""])
def test_git_with_shell_expansion_needs_a_card(tmp_path, cmd):
    assert decision(vault_rule(tmp_path, "Bash", {"command": cmd})) in ("ask", "deny")
