from orb import away, protocol, server

H = 3600


def clock(tmp_path):
    return away.Clock(tmp_path / "away.json")


def test_under_a_day_away_there_is_no_recap(tmp_path):
    c = clock(tmp_path)
    c.acted(now=1000)
    assert c.current(now=1000 + 23 * H) is None
    assert c.acted(now=1000 + 23 * H) is False
    assert c.recap is None


def test_a_day_or_more_away_is_live_until_the_owner_acts(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    live = c.current(now=30 * H)
    assert live == {"since": 0, "back": None, "heading": "While you were away · 30 hours", "lines": [], "more": 0}
    assert c.current(now=50 * H)["heading"] == "While you were away · 2 days"  # the span grows while away


def test_heading_hours_below_48_days_from_48():
    assert away.heading(24 * H) == "While you were away · 24 hours"
    assert away.heading(47 * H + 3599) == "While you were away · 47 hours"
    assert away.heading(48 * H) == "While you were away · 2 days"
    assert away.heading(80 * H) == "While you were away · 3 days"


def test_first_action_back_freezes_the_recap(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    assert c.acted(now=50 * H) is True
    assert c.acted(now=51 * H) is False  # later actions leave it alone
    assert c.current(now=52 * H) == {"since": 0, "back": 50 * H, "heading": "While you were away · 2 days", "lines": [], "more": 0}


def test_seen_is_one_shot_until_away_again(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    c.acted(now=50 * H)
    assert c.seen() is True
    assert c.seen() is False
    assert c.current(now=51 * H) is None
    c.acted(now=52 * H)
    assert c.current(now=60 * H) is None  # under a day since the last action
    assert c.current(now=52 * H + 24 * H)["back"] is None  # away again: a new recap


def test_a_recap_nobody_closed_goes_after_recap_keep(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    c.acted(now=50 * H)
    assert c.current(now=50 * H + away.RECAP_KEEP - 1) is not None
    assert c.current(now=50 * H + away.RECAP_KEEP) is None


def test_clock_and_recap_survive_a_restart(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    assert clock(tmp_path).last_active == 0
    c.acted(now=10)  # under SAVE_EVERY: not written yet
    assert clock(tmp_path).last_active == 0
    c.acted(now=50 * H)  # the recap changed: written at once
    again = clock(tmp_path)
    assert again.last_active == 50 * H and again.recap == {"since": 10, "back": 50 * H}
    assert (tmp_path / "away.json").stat().st_mode & 0o777 == 0o600


def test_a_page_that_only_opens_or_reads_is_not_acting():
    for t in ("hello", "home", "routines", "screen", "open_folder", "list_folders", "tasks_list", "speech_start"):
        assert t not in away.ACTIONS
    assert {"user_text", "permission", "plan_start", "away_seen"} <= away.ACTIONS


def test_every_delegation_tap_is_the_owner_acting():
    # Reopen PR too (#880): it is outward, but the tap is the owner's, like Push or Merge (delegation_outward)
    taps = {t for t in protocol.CLIENT_MESSAGES if t.startswith(("delegate", "delegation_"))} | {"revoke_grant"}
    assert "delegation_reopen" in taps and taps <= away.ACTIONS, taps - away.ACTIONS


def test_every_action_is_a_message_the_page_can_send():
    assert away.ACTIONS <= protocol.CLIENT_MESSAGES.keys(), away.ACTIONS - protocol.CLIENT_MESSAGES.keys()


def test_event_matches_the_protocol(tmp_path):
    c = clock(tmp_path)
    assert protocol.AwayRecapEvent.model_validate(c.event(now=0)).recap is None
    c.acted(now=0)
    protocol.AwayRecapEvent.model_validate(c.event(now=30 * H))


def test_hub_keeps_its_clock_in_the_state_folder():
    assert server.hub.away.path == server.config.STATE_DIR / "away.json"




class _Conn:
    def __init__(self):
        self.sent = []

    async def send(self, ev):
        self.sent.append(ev)


async def test_closing_the_card_freezes_then_clears_it_on_every_page(tmp_path, monkeypatch):
    import time

    monkeypatch.setitem(server.settings.settings.data, "onboarded", True)
    c = clock(tmp_path)
    c.last_active = time.time() - 30 * H
    monkeypatch.setattr(server.hub, "away", c)
    pushed = []

    async def push_all(ev):
        pushed.append(ev)

    monkeypatch.setattr(server.hub, "push_all", push_all)
    conn = _Conn()
    for msg in ({"type": "home"}, {"type": "routines"}):  # a page opening Home or polling is not acting
        await server.owner_acted(msg)
    assert c.recap is None and c.last_active < time.time() - 29 * H and pushed == []
    msg = {"type": "away_seen"}
    await server.owner_acted(msg)
    await server.handle(conn, msg)
    assert pushed[0]["recap"]["back"] is not None and pushed[1] == {"type": "away_recap", "recap": None}  # frozen, then seen
    assert c.recap is None and c.current() is None


def test_the_card_keeps_eight_lines_and_counts_the_rest(tmp_path):
    c = clock(tmp_path)
    c.last_active = 0
    lines = lambda since: [{"kind": "routine", "id": f"t{i}", "title": f"r{i}", "summary": "", "count": 1, "at": i} for i in range(11)]
    r = c.current(now=30 * H, lines=lines)
    assert [x["id"] for x in r["lines"]] == [f"t{i}" for i in range(8)] and r["more"] == 3
    assert "at" not in r["lines"][0]
    protocol.AwayRecapEvent.model_validate(c.event(now=30 * H, lines=lines))
    assert c.current(now=30 * H)["lines"] == [] and c.current(now=30 * H)["more"] == 0


def test_the_hub_gives_routine_lines_only_while_the_routines_panel_is_on(tmp_path, monkeypatch):
    import time

    c = clock(tmp_path)
    c.last_active = time.time() - 30 * H
    monkeypatch.setattr(server.hub, "away", c)
    seen = []
    monkeypatch.setattr(server.routines, "away_lines", lambda items, runs, logs, since: seen.append(since) or [
        {"kind": "routine", "id": "t1", "title": "Curation", "summary": "ok", "count": 2, "at": 1.0}])
    monkeypatch.setitem(server.settings.settings.data, "routines", True)
    assert server.hub.away_event()["recap"]["lines"][0]["count"] == 2 and seen == [c.last_active]
    monkeypatch.setitem(server.settings.settings.data, "routines", False)
    assert server.hub.away_event()["recap"]["lines"] == []


def test_own_lines_count_finished_and_ready_since_the_owner_left_and_say_nothing_at_0():
    assert away.own_lines([], [], 100) == []
    assert away.own_lines([50, 0.0], [99], 100) == []  # before last-active (or no time): not counted
    assert away.own_lines([150, 50, 120], [130], 100) == [
        {"kind": "finished", "id": "finished", "title": "2 sessions finished", "summary": "", "count": 2, "at": 150},
        {"kind": "ready", "id": "ready", "title": "1 delegation Ready", "summary": "", "count": 1, "at": 130}]
    assert [x["title"] for x in away.own_lines([150], [130, 140], 100)] == ["1 session finished", "2 delegations Ready"]


def test_own_lines_follow_the_routines_under_the_same_cap(tmp_path):
    c = clock(tmp_path)
    c.acted(now=0)
    ran = [{"kind": "routine", "id": f"t{i}", "title": f"R{i}", "summary": "", "count": 1, "at": 9} for i in range(7)]
    rec = c.current(now=30 * H, lines=lambda since: ran + away.own_lines([H], [2 * H], since))
    assert [x["kind"] for x in rec["lines"]] == ["routine"] * 7 + ["finished"] and rec["more"] == 1


def test_the_hub_counts_unopened_finished_sessions_and_ready_delegations(tmp_path, monkeypatch):
    import time

    from orb import server
    from orb.sessions import SessionStore

    hub = server.hub
    now = time.time()
    st = SessionStore(tmp_path / "s.json")
    keys = {n: st.new_session("/r") for n in ("a", "b", "c", "d", "deleg")}
    for n, at in (("a", now - 10), ("b", now - 50 * H), ("d", now - 10), ("deleg", now - 10)):
        st.set_finished("/r", keys[n], at)  # c was opened: no finished_at
    st.set_archived("/r", keys["d"], True)
    monkeypatch.setattr(hub, "store", st)
    monkeypatch.setattr(hub, "folder_list", lambda: [{"label": "acme", "path": "/r", "sessions": []}])
    monkeypatch.setattr(hub.delegator, "items", {
        "1": {"session": keys["deleg"], "stage": "ready", "ready_at": now - 20},
        "2": {"session": "x", "stage": "ready", "ready_at": now - 50 * H},
        "3": {"session": "y", "stage": "ready"}})  # Ready before this change: no time, not counted
    monkeypatch.setitem(server.settings.settings.data, "routines", False)
    got = hub.away_lines(now - 30 * H)
    assert [(x["kind"], x["count"]) for x in got] == [("finished", 1), ("ready", 1)]


def test_peek_reads_the_pending_or_the_last_recap_and_changes_nothing(tmp_path):
    c = clock(tmp_path)
    assert c.peek(now=0) is None
    c.acted(now=0)
    assert c.peek(now=H) is None
    assert c.peek(now=30 * H) == {**c.current(now=30 * H), "seen": False}  # live while still away
    c.acted(now=50 * H)
    before = (c.last_active, dict(c.recap), c.last, c.path.read_text())
    got = c.peek(now=51 * H, lines=lambda since: [{"kind": "routine", "id": "t1", "title": "x", "summary": "", "count": 1, "at": 1}])
    assert got["seen"] is False and got["back"] == 50 * H and got["lines"][0]["id"] == "t1"
    assert (c.last_active, c.recap, c.last, c.path.read_text()) == before  # the card's one-shot state stays
    c.seen()
    assert c.current(now=52 * H) is None and c.peek(now=52 * H)["seen"] is True
    assert clock(tmp_path).peek(now=52 * H)["since"] == 0  # the last one survives a restart
    c.acted(now=200 * H)  # away again, not seen: the new one is pending, then expires into the last one
    assert c.peek(now=202 * H)["seen"] is False and c.peek(now=202 * H)["back"] == 200 * H
    assert c.peek(now=200 * H + away.RECAP_KEEP)["seen"] is True and c.recap is not None  # expired: shown as the last one, not cleared


def test_the_hub_names_needs_you_for_the_home_chat(tmp_path, monkeypatch):
    c = clock(tmp_path)
    c.last_active = 0
    monkeypatch.setattr(server.hub, "away", c)
    monkeypatch.setattr(server.hub, "folder_list", lambda: [{"label": "acme/globex", "path": "/r", "sessions": [
        {"label": "Fix login", "status": "approval"}, {"label": "Other", "status": "idle"}]}])
    monkeypatch.setattr(server.hub.delegator, "event", lambda: {"items": [
        {"task": 12, "title": "Ship it", "repo": "globex", "line": "Tests failed", "needs": "failed"},
        {"task": 13, "title": "Fine", "repo": "globex", "line": "Ready", "needs": None}]})
    monkeypatch.setattr(server.hub.needs, "needs_rows", lambda: [{"title": "nightly", "reason": "Failed."}])
    got = server.hub.away_brief()
    assert got["seen"] is False and got["needs"] == [
        "acme/globex: Fix login, waiting for your OK", "Delegated #12 Ship it (globex): Tests failed", "nightly: Failed."]
    assert c.recap is None  # reading it opened nothing
