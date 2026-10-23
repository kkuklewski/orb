import asyncio

from claude_agent_sdk import TaskNotificationMessage, TaskStartedMessage

from orb import agent, chain
from orb.agent import FolderSession, Speaker, VoiceInput
from orb.sessions import SessionStore
from orb.settings import Settings

from test_voice_input import FakeSession, Store


# -- smart hold ----------------------------------------------------------------------------

def test_hold_is_short_after_a_finished_sentence():
    v = VoiceInput(FakeSession())
    for text, hold in [("What's 2 plus 2?", 0.3), ("Fix the build.", 0.3), ("Do it now!", 0.3),
                       ('He said "stop."', 0.3), ("So I was thinking", 1.0), ("and then...", 1.0),
                       ("Na przykład,", 1.0)]:
        v.parts = [text]
        assert v.hold_seconds() == hold, text


async def test_finished_sentence_is_sent_before_the_long_hold(monkeypatch):
    async def fake_transcribe(wav):
        return "What is the capital of Poland?"

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.5)
    monkeypatch.setattr(VoiceInput, "HOLD_DONE", 0.02)
    s = FakeSession()
    await VoiceInput(s).utterance(b"1")
    await asyncio.sleep(0.1)
    assert s.sent == ["What is the capital of Poland?"]


async def test_speech_during_the_short_hold_still_merges(monkeypatch):
    texts = iter(["I want two things.", "And a third one."])

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD_DONE", 0.05)
    s = FakeSession()
    v = VoiceInput(s)
    await v.utterance(b"1")
    v.speech_start()  # he goes on before the short hold ends
    await asyncio.sleep(0.1)
    assert s.sent == []
    await v.utterance(b"2")
    await asyncio.sleep(0.1)
    assert s.sent == ["I want two things. And a third one."]


# -- TTS prefetch -------------------------------------------------------------------------

def speaker_with(monkeypatch, delays):
    from orb.settings import settings
    monkeypatch.setitem(settings.data, "tts", "kokoro")  # these test the Kokoro prefetch
    started, events = [], []

    async def fake_synth(text, voice=None):
        started.append(text)
        await asyncio.sleep(delays.get(text, 0.01))
        return text.encode()

    async def emit(ev):
        events.append(ev)

    monkeypatch.setattr(agent.speech, "synthesize", fake_synth)
    return Speaker(emit, lambda: True), started, events


async def test_prefetch_synthesizes_ahead_but_keeps_order(monkeypatch):
    sp, started, events = speaker_with(monkeypatch, {"one": 0.08, "two": 0.01, "three": 0.01, "four": 0.01})
    sp.say(["one", "two", "three", "four"])
    await asyncio.sleep(0.02)
    assert started == ["one", "two", "three"]  # the current one plus AHEAD = 2
    await asyncio.sleep(0.15)
    assert [e["text"] for e in events if e["type"] == "audio"] == ["one", "two", "three", "four"]
    assert [e["seq"] for e in events if e["type"] == "audio"] == [1, 2, 3, 4]


async def test_speaks_again_after_going_idle(monkeypatch):
    sp, started, events = speaker_with(monkeypatch, {})
    sp.say(["first answer"])
    await asyncio.sleep(0.05)  # the worker is idle now, waiting for more
    await sp.reset()  # the next turn
    sp.say(["second answer"])
    await asyncio.sleep(0.05)
    sp.say(["third"])
    await asyncio.sleep(0.05)
    assert [e["text"] for e in events if e["type"] == "audio"] == ["first answer", "second answer", "third"]


async def test_reset_cancels_prefetched_clips(monkeypatch):
    sp, started, events = speaker_with(monkeypatch, {"one": 0.05, "two": 0.05, "three": 0.05})
    sp.say(["one", "two", "three"])
    await asyncio.sleep(0.01)
    await sp.reset()  # barge-in
    assert sp.inflight == []
    sp.say(["new"])
    await asyncio.sleep(0.1)
    assert [e["text"] for e in events if e["type"] == "audio"] == ["new"]
    assert all(e["gen"] == 1 for e in events if e["type"] == "audio")


# -- the chain ----------------------------------------------------------------------------

def test_switch_request():
    assert chain.switch_request("Switch to Opus.") == "opus"
    assert chain.switch_request("switch back to sonnet") == "sonnet"
    assert chain.switch_request("Przełącz na Opus") == "opus"
    assert chain.switch_request("przełącz się na sonnet!") == "sonnet"
    assert chain.switch_request("Should we switch to Opus for the refactor?") is None
    assert chain.switch_request("use Opus to refactor the fence") is None  # that's a delegation


def session(emit=None, **kw):
    async def noop(ev):
        pass
    return FolderSession("/x", "k1", Store(), emit or noop, lambda: False, **kw)


def test_options_have_front_model_coder_and_routing():
    s = session()
    o = s._options()
    assert o.model == "sonnet" and o.effort == chain.EFFORT["sonnet"]
    assert o.agents["opus-coder"].model == "opus" and o.agents["opus-coder"].effort == "high"
    assert o.agents["opus-coder"].maxTurns
    assert "opus-coder" in o.system_prompt["append"] and "<spoken>" in o.system_prompt["append"]
    assert o.permission_mode == "default"  # approvals stay on
    s.model = "opus"
    assert s._options().model == "opus" and s._options().effort is None


def test_model_is_stored_per_folder(tmp_path):
    st = SessionStore(tmp_path / "s.json")
    assert st.model("/a") == "sonnet"
    st.set_model("/a", "opus")
    assert SessionStore(tmp_path / "s.json").model("/a") == "opus"
    assert st.model("/b") == "sonnet"


def test_default_model_setting(tmp_path):
    s = Settings(tmp_path / "settings.json")
    assert s["default_model"] == "sonnet"
    s.update({"default_model": "opus"})
    assert Settings(tmp_path / "settings.json")["default_model"] == "opus"
    s.update({"default_model": "gpt"})
    assert s["default_model"] == "opus"


async def test_voice_switch_changes_the_model_without_a_query(monkeypatch):
    s = session()
    said = []
    monkeypatch.setattr(s.speaker, "say", lambda xs: said.extend(xs))
    await s.send("Switch to Opus.", "voice")
    assert s.model == "opus" and s.client is None  # no Claude Code started for it
    assert said == ["Switched to Opus."]


class FakeClient:
    def __init__(self):
        self.models = []

    async def set_model(self, m):
        self.models.append(m)

    async def disconnect(self):
        pass


async def test_switch_during_a_turn_is_live_then_reconnects(monkeypatch):
    s = session()
    s.client, s.open_turns = FakeClient(), 1
    await s.set_model("opus")
    assert s.client.models == ["opus"] and s.reconnect_after


async def test_switch_never_reconnects_while_opus_runs(monkeypatch):
    s = session()
    s.client = FakeClient()
    s.tasks["t1"] = {"status": "running"}
    await s.set_model("opus")
    assert s.client is not None and s.client.models == ["opus"]


async def test_opus_task_chip_and_done_line(monkeypatch):
    events = []

    async def emit(ev):
        events.append(ev)

    s = session(emit)
    said = []
    monkeypatch.setattr(s.speaker, "say", lambda xs: said.extend(xs))
    s.coder_calls.add("toolu_9")
    await s._handle(TaskStartedMessage(subtype="task_started", data={}, task_id="t1", description="Refactor the fence",
                                       uuid="u", session_id="sid", tool_use_id="toolu_9"))
    assert s.running_tasks() and [e for e in events if e["type"] == "task"][-1]["coder"]
    await s._handle(TaskNotificationMessage(subtype="task_notification", data={}, task_id="t1", status="completed",
                                            output_file="/tmp/x", summary="Done", uuid="u2", session_id="sid"))
    assert not s.running_tasks()
    assert said == ["Opus is done."]
    assert [e for e in events if e["type"] == "task"][-1]["status"] == "completed"
