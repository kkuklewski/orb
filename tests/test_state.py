"""config.read_state: a bad state file is set aside, never reset silently (docs/adr/0014)."""

import json
import os

import pytest

from orb import config


def test_missing_is_none_and_quiet(tmp_path):
    assert config.read_state(tmp_path / "sessions.json") is None
    assert config.set_aside == []


def test_good_file(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text(json.dumps({"version": 2}))
    assert config.read_state(p) == {"version": 2}
    assert config.set_aside == []


def test_bad_json_is_set_aside_unchanged(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text("{not json")
    assert config.read_state(p) is None
    assert not p.exists()
    copies = list(tmp_path.glob("sessions.json.bad-*"))
    assert len(copies) == 1 and copies[0].read_text() == "{not json"
    assert config.set_aside == [{"name": "sessions.json", "copy": str(copies[0]), "precious": True}]


def test_wrong_shape_is_set_aside(tmp_path):
    p = tmp_path / "needs.json"
    p.write_text("[1, 2]")
    assert config.read_state(p) is None
    assert config.set_aside[0]["name"] == "needs.json" and config.set_aside[0]["precious"] is False


def test_custom_check(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("[1]")
    assert config.read_state(p, check=lambda d: isinstance(d, list)) == [1]


def test_not_utf8_is_bad(tmp_path):
    p = tmp_path / "away.json"
    p.write_bytes(b"\xff\xfe\x00")
    assert config.read_state(p) is None
    assert list(tmp_path.glob("away.json.bad-*"))


def test_unreadable_is_set_aside(tmp_path):
    if os.geteuid() == 0:
        pytest.skip("root reads anything")
    p = tmp_path / "worktrees.json"
    p.write_text("{}")
    p.chmod(0)
    assert config.read_state(p) is None
    assert not p.exists() and config.set_aside[0]["precious"] is True


def test_a_directory_is_set_aside(tmp_path):
    (tmp_path / "delegations.json").mkdir()
    assert config.read_state(tmp_path / "delegations.json") is None
    assert list(tmp_path.glob("delegations.json.bad-*"))


def test_keeps_newest_three(tmp_path):
    p = tmp_path / "settings.json"
    for _ in range(5):
        p.write_text("{bad")
        config.read_state(p)
    copies = sorted(tmp_path.glob("settings.json.bad-*"))
    assert len(copies) == config.BAD_KEEP
    assert copies[-1].name == config.set_aside[-1]["copy"].rsplit("/", 1)[-1]


# Precious stores (ticket 843): set aside, start fresh, Needs you setup row while the copy is there.

def _bad(tmp_path, name):
    p = tmp_path / name
    p.write_text("{bad")
    return p


def test_settings_set_aside_starts_from_defaults(tmp_path):
    from orb import settings
    s = settings.Settings(_bad(tmp_path, "settings.json"))
    assert s.data["profile"] == settings.DEFAULTS["profile"]
    assert config.set_aside[0]["name"] == "settings.json"


def test_sessions_set_aside(tmp_path):
    from orb import sessions
    store = sessions.SessionStore(_bad(tmp_path, "sessions.json"))
    assert store.data == {}
    assert list(tmp_path.glob("sessions.json.bad-*"))


def test_delegations_set_aside(tmp_path):
    from orb import delegation
    async def nothing(*a):
        return None
    d = delegation.Delegator(_bad(tmp_path, "delegations.json"), store=None, session=lambda *a: None, push=nothing, done=nothing)
    assert d.items == {}
    assert list(tmp_path.glob("delegations.json.bad-*"))


def test_worktrees_set_aside(tmp_path, monkeypatch):
    from orb import worktree
    p = _bad(tmp_path, "worktrees.json")
    monkeypatch.setattr(worktree, "_registry_path", lambda: p)
    monkeypatch.setattr(worktree, "_cache", None)
    assert worktree._load() == {}
    assert list(tmp_path.glob("worktrees.json.bad-*"))


def test_needs_you_row_while_the_copy_is_there(tmp_path):
    from orb import needs, sessions
    sessions.SessionStore(_bad(tmp_path, "sessions.json"))
    config.read_state(_bad(tmp_path, "needs.json"))  # not precious: no row
    rows = needs.setup_problems({}, None, "browser", "browser", {}, False)
    assert [r["id"] for r in rows] == ["state-sessions"]
    assert rows[0]["title"] == "Orb set aside a damaged sessions.json" and "sessions.json.bad-" in rows[0]["reason"]
    for copy in tmp_path.glob("sessions.json.bad-*"):
        copy.unlink()
    assert needs.setup_problems({}, None, "browser", "browser", {}, False) == []


# Rebuildable stores: set aside, started from the default, a log line and no Needs you row.

async def _nothing(*a):
    return None


def test_away_set_aside(tmp_path):
    from orb import away
    c = away.Clock(_bad(tmp_path, "away.json"))
    assert c.last_active is None and c.recap is None
    assert list(tmp_path.glob("away.json.bad-*"))


def test_needs_ranking_set_aside(tmp_path):
    from orb import needs
    p = tmp_path / "needs.json"
    p.write_text(json.dumps({"ranking": "not a list"}))
    n = needs.Needs(p, ask=_nothing, push=_nothing)
    assert n.state["ranking"] == []
    assert list(tmp_path.glob("needs.json.bad-*"))


def test_routines_set_aside(tmp_path):
    from orb import routines
    w = routines.Watch(_bad(tmp_path, "routines.json"), notify=_nothing, push=_nothing)
    assert w.state["runs"] == {} and w.state["repair"] == {}
    assert list(tmp_path.glob("routines.json.bad-*"))


def test_triage_set_aside(tmp_path):
    from orb import triage
    assert triage.load(_bad(tmp_path, "priority-suggestions.json")) == {}
    assert list(tmp_path.glob("priority-suggestions.json.bad-*"))


def test_captures_set_aside(tmp_path):
    from orb import brain
    assert brain.CaptureGuard(_bad(tmp_path, "captures.json")).count() == 0
    assert list(tmp_path.glob("captures.json.bad-*"))


def test_rebuildable_stores_log_only(tmp_path):
    from orb import needs
    test_away_set_aside(tmp_path)
    test_triage_set_aside(tmp_path)
    assert config.set_aside and not any(b["precious"] for b in config.set_aside)
    assert needs.setup_problems({}, None, "browser", "browser", {}, False) == []


# Bounds for stores that grow (docs/adr/0014).

def test_timing_keeps_newest_lines(tmp_path):
    from orb import timing
    p = tmp_path / "timing.jsonl"
    p.write_text("".join(f'{{"n": {i}}}\n' for i in range(12)))
    timing.trim(p, keep=5)
    assert [json.loads(x)["n"] for x in p.read_text().splitlines()] == [7, 8, 9, 10, 11]
    assert oct(p.stat().st_mode & 0o777) == "0o600"
    timing.trim(p, keep=5)  # at the bound: untouched
    assert len(p.read_text().splitlines()) == 5
    timing.trim(tmp_path / "missing.jsonl")  # nothing to trim


def test_routines_state_keeps_what_streak_and_screen_read():
    from orb import routines
    runs = [{"id": f"r{i}"} for i in range(8)]
    st = {"routines": {"acme": {}}, "runs": {"acme": runs, "gone": [{"id": "g1"}]},
          "logs": {"r0": {}, "r6": {}, "g1": {}}, "verdicts": {"r4": {}, "g1": {}},
          "seen": {"acme": "r0", "gone": "g1"}, "resolved": {"acme": "r1", "gone": "g1"}}
    routines.trim(st)
    assert [x["id"] for x in st["runs"]["acme"]] == ["r0", "r1", "r2", "r3", "r4"] and "gone" not in st["runs"]
    assert st["logs"] == {"r0": {}} and st["verdicts"] == {"r4": {}}
    assert st["seen"] == {"acme": "r0"} and st["resolved"] == {"acme": "r1"}
