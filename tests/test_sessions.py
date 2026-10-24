

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
