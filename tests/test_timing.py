from orb.timing import TurnTiming


def test_hops_between_marks():
    t = TurnTiming("u1", "voice", {"audio": 10.0, "stt": 10.6})
    for name, at in (("send", 11.6), ("query", 11.6), ("token", 13.9), ("spoken", 14.3), ("clip", 14.7), ("done", 20.0)):
        t.mark(name, at)
    assert t.hops() == {"stt": 600, "hold": 1000, "conn": 0, "ttft": 2300, "say": 400, "tts": 400,
                        "server": 4700, "turn": 8400}


def test_a_mark_is_kept_once():
    t = TurnTiming("u1", "text")
    assert t.mark("token", 1.0)
    assert not t.mark("token", 2.0)
    assert t.marks["token"] == 1.0


def test_typed_turn_has_no_voice_hops():
    t = TurnTiming("u1", "text")
    t.mark("send", 0.0)
    t.mark("query", 0.5)
    t.mark("token", 2.0)
    assert t.hops() == {"conn": 500, "ttft": 1500}
