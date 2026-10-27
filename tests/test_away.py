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
