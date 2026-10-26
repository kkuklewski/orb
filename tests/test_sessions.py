

def test_archive_and_remove(tmp_path):
    from orb.sessions import SessionStore
    st = SessionStore(tmp_path / "s.json")
    a, b = st.new_session("/r"), st.new_session("/r")
    assert st.set_archived("/r", b, True)
    assert st.active("/r") is None
    assert st.open("/r") == a  # archived is skipped
    assert st.sessions("/r")[0].get("archived") or st.sessions("/r")[1].get("archived")
    assert st.set_archived("/r", b, False)
    assert st.remove("/r", a) and not st.remove("/r", a)
    assert [x["key"] for x in st.sessions("/r")] == [b]


def test_state_files_are_private(tmp_path):
    from orb import config
    path = tmp_path / "state" / "x.json"
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "x.tmp").write_text("old")
    (tmp_path / "state" / "x.tmp").chmod(0o644)  # a leftover from an older build
    config.write_private(path, "{}")
    config.append_private(tmp_path / "state" / "log.jsonl", "a\n")
    config.append_private(tmp_path / "state" / "log.jsonl", "b\n")
    assert path.read_text() == "{}" and (tmp_path / "state" / "log.jsonl").read_text() == "a\nb\n"
    assert {p.name: p.stat().st_mode & 0o777 for p in (tmp_path / "state").iterdir()} == {"x.json": 0o600, "log.jsonl": 0o600}
