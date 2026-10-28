"""config.read_state: a bad state file is set aside, never reset silently (docs/adr/0014)."""

import json
import os

import pytest

from orb import config


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(config, "set_aside", [])


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
