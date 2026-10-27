"""Expiry (docs/adr/0013): Orb repeats the vault's rule to show when an AI page will be archived, never archives it,
and the vault's `auto_archived` wins. The fact-checked waiting rule counts only notes under scrapers/."""

import os

from orb import brain, home

PAGE = {"curated_by": "ai", "human_reviewed": "false", "value_score": "3", "curated_at": "2026-10-20"}


def test_one_constant_names_the_vault_decision():
    assert brain.EXPIRY_DAYS == 14
    src = open(brain.__file__).read()
    assert src.count("EXPIRY_DAYS = ") == 1 and "2026-10-19" in src and 'skills/value.md "Expiry"' in src


def test_the_expiry_day_is_curated_at_plus_14_days_else_created():
    assert brain.expiry(PAGE) == "2026-11-03"
    assert brain.expiry({**PAGE, "curated_at": "2026-10-20T08:15:00Z"}) == "2026-11-03"
    assert brain.expiry({k: v for k, v in PAGE.items() if k != "curated_at"} | {"created": "2026-10-01"}) == "2026-10-15"
    assert brain.expiry({k: v for k, v in PAGE.items() if k != "curated_at"}) == ""  # no date: no chip
    assert brain.expiry({**PAGE, "curated_at": "soon"}) == ""


def test_only_the_vault_rules_own_pages_expire():
    assert brain.expiry({**PAGE, "value_score": "4"}) == "2026-11-03"
    for change in ({"value_score": "5"}, {"value_score": ""}, {"owner_read": "2026-10-21"}, {"human_verdict": "approve"},
                   {"human_verdict": "reject"}, {"human_reviewed": "true"}, {"auto_archived": "2026-11-04"}, {"curated_by": ""}):
        assert brain.expiry({**PAGE, **change}) == "", change


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.utime(path, (1_800_000_000, 1_800_000_000))


def test_fact_checked_notes_wait_only_under_scrapers(tmp_path):
    checked = "---\nfact_checked_at: 2026-06-17\n---\n# Acme release\n"
    write(tmp_path / "documentation" / "acme.md", checked)
    write(tmp_path / "forge" / "globex.md", checked)
    write(tmp_path / "memory.md", checked)
    write(tmp_path / "scrapers" / "Inbox" / "acme.md", checked)
    assert [n["file"] for n in home.awaiting_notes(tmp_path)] == ["scrapers/Inbox/acme.md"]
    rows = {r["file"]: r["waiting"] for r in home.brain_notes(tmp_path)}
    assert rows == {"documentation/acme.md": False, "forge/globex.md": False, "memory.md": False, "scrapers/Inbox/acme.md": True}
    assert (tmp_path / "documentation" / "acme.md").read_text() == checked  # nothing written


def test_brain_rows_carry_the_expiry_day_and_an_archived_page_is_gone(tmp_path):
    fm = "".join(f"{k}: {v}\n" for k, v in PAGE.items())
    write(tmp_path / "scrapers" / "Topics" / "acme.md", f"---\n{fm}---\n# Acme\n")
    write(tmp_path / "scrapers" / "Topics" / "globex.md", f"---\n{fm}auto_archived: 2026-10-30\n---\n# Globex\n")
    write(tmp_path / "scrapers" / "Topics" / "kept.md", f"---\n{fm}human_verdict: approve\n---\n# Kept\n")
    rows = {r["file"]: r["expires"] for r in home.brain_notes(tmp_path)}
    assert rows == {"scrapers/Topics/acme.md": "2026-11-03", "scrapers/Topics/kept.md": ""}
