import asyncio

from orb import agent
from orb.agent import VoiceInput


class FakeSession:
    def __init__(self):
        self.sent: list[str] = []
        self.busy = False
        self.path = "/x"
        self.key = "k0"
        self.interrupted = 0
        self.pending = {}
        self.undo_card = None

    async def state(self, value):
        pass

    async def emit(self, ev):
        pass

    async def _emit(self, ev):
        pass

    async def interrupt(self):
        self.interrupted += 1

    async def send(self, text, source):
        self.sent.append(text)


async def test_fragments_said_within_the_hold_become_one_request(monkeypatch):
    texts = iter(["So I was thinking", "about running it all day."])

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.05)
    s = FakeSession()
    v = VoiceInput(s)
    v.speech_start()
    await v.utterance(b"1")
    v.speech_start()  # he goes on talking before the hold ends
    await asyncio.sleep(0.1)
    assert s.sent == []
    await v.utterance(b"2")
    await asyncio.sleep(0.1)
    assert s.sent == ["So I was thinking about running it all day."]


async def test_separate_requests_after_the_hold(monkeypatch):
    texts = iter(["First.", "Second."])

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.02)
    s = FakeSession()
    v = VoiceInput(s)
    await v.utterance(b"1")
    await asyncio.sleep(0.05)
    s.busy = True
    await v.utterance(b"2")
    await asyncio.sleep(0.05)
    assert s.sent == ["First.", "Second."]
    assert s.interrupted == 1  # a new request while busy interrupts the running turn


async def test_blank_audio_is_not_sent(monkeypatch):
    async def fake_transcribe(wav):
        return "[BLANK_AUDIO]"

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.01)
    s = FakeSession()
    await VoiceInput(s).utterance(b"1")
    await asyncio.sleep(0.03)
    assert s.sent == []


# -- approval cards answered by voice (real FolderSession, SDK calls stubbed) --------------

from orb.agent import FolderSession  # noqa: E402


class Store:
    def resume_id(self, f, k): return None
    def mode(self, f, default="default"): return default
    def set_resume(self, *a): pass
    def set_mode(self, *a): pass
    def model(self, f, default="sonnet"): return default
    def set_model(self, *a): pass
    def label_from_request(self, *a): pass
    def touch(self, *a): pass


class Ctx:
    tool_use_id = "toolu_1"
    title = None
    description = None
    blocked_path = None
    display_name = None


async def card_session(monkeypatch, transcripts):
    texts = iter(transcripts)

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.01)
    events = []

    async def emit(ev):
        events.append(ev)

    s = FolderSession("/x", "k1", Store(), emit, lambda: False)
    s.open_turns = 1  # a turn is running and waiting on the card
    calls = {"sent": [], "interrupted": 0}

    async def fake_send(text, source="text"):
        calls["sent"].append(text)

    async def fake_interrupt():
        calls["interrupted"] += 1
        await s._deny_pending("The user interrupted.")

    monkeypatch.setattr(s, "send", fake_send)
    monkeypatch.setattr(s, "interrupt", fake_interrupt)
    decision = asyncio.create_task(s._can_use_tool("Bash", {"command": "grep -n x f", "description": "Check speech models"}, Ctx()))
    await asyncio.sleep(0.01)
    assert s.pending
    return s, decision, calls, events


async def test_short_yes_by_voice_allows_the_card(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, ["Yeah, you can. Approve."])
    await s.voice.utterance(b"1")
    result = await asyncio.wait_for(decision, 1)
    assert result.behavior == "allow"
    assert calls == {"sent": [], "interrupted": 0}
    done = [e for e in events if e["type"] == "permission_done"][0]
    assert done["allow"] and done["heard"] == "Yeah, you can. Approve."


async def test_short_no_by_voice_denies_the_card(monkeypatch):
    s, decision, calls, _ = await card_session(monkeypatch, ["No, don't."])
    await s.voice.utterance(b"1")
    assert (await asyncio.wait_for(decision, 1)).behavior == "deny"
    assert calls["interrupted"] == 0


async def test_long_or_ambiguous_speech_is_held_and_never_denies(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, ["Wait, what does that grep actually look for in the file?"])
    await s.voice.utterance(b"1")
    await asyncio.sleep(0.05)
    assert not decision.done()  # card still open
    assert calls == {"sent": [], "interrupted": 0}
    assert [e["text"] for e in events if e["type"] == "held"] == ["Wait, what does that grep actually look for in the file?"]
    # Once the card is answered (here by click), the held speech becomes the next request.
    await s.answer_permission(next(iter(s.pending)), True)
    assert (await asyncio.wait_for(decision, 1)).behavior == "allow"
    await asyncio.sleep(0.02)
    assert calls["sent"] == ["Wait, what does that grep actually look for in the file?"]


def test_spoken_prompt_uses_the_tool_description():
    from orb.agent import spoken_permission_prompt
    assert spoken_permission_prompt("Bash", {"description": "Check current speech models"}) == "Allow: check current speech models?"
    assert spoken_permission_prompt("Write", {"file_path": "/a/b.txt"}) == "Allow: write a file?"


async def test_voice_verdict_needs_exactly_one_card(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, ["Yes."])
    second = asyncio.create_task(s._can_use_tool("Write", {"file_path": "/x/a"}, Ctx()))
    await asyncio.sleep(0.01)
    await s.voice.utterance(b"1")
    await asyncio.sleep(0.05)
    assert not decision.done() and not second.done()  # two cards: which one? hold it
    assert [e["text"] for e in events if e["type"] == "held"] == ["Yes."]
    for pid in list(s.pending):
        await s.answer_permission(pid, False)
    await asyncio.gather(decision, second)


async def test_speech_that_began_before_the_card_does_not_answer_it(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, ["Yes."])
    s.voice.started = 0.0  # this speech started before the card appeared
    s.voice.parts = []
    s.voice.speaking = True
    await s.voice.utterance(b"1")
    await asyncio.sleep(0.05)
    assert not decision.done()
    await s.answer_permission(next(iter(s.pending)), False)
    await decision


async def test_possible_echo_of_her_own_voice_does_not_answer(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, ["Yes."])
    s.voice.speech_start(echo_risk=True)  # began while she was playing on speakers
    await s.voice.utterance(b"1")
    await asyncio.sleep(0.05)
    assert not decision.done()
    await s.answer_permission(next(iter(s.pending)), False)
    await decision


def test_spoken_prompt_drops_yes_no_words_from_model_text():
    from orb.agent import spoken_permission_prompt
    p = spoken_permission_prompt("Bash", {"description": "Yes approve: list files"})
    assert p == "Allow: list files?"


async def test_background_session_reports_done_and_approval(monkeypatch):
    notes = []

    async def notify(session, kind):
        notes.append(kind)

    async def emit(ev):
        pass

    s = FolderSession("/x", "k1", Store(), emit, lambda: False, viewed=lambda: False, notify=notify)
    task = asyncio.create_task(s._can_use_tool("Bash", {"command": "ls"}, Ctx()))
    await asyncio.sleep(0.01)
    assert s.status == "approval" and notes == ["approval"]
    await s.answer_permission(next(iter(s.pending)), True)
    await task
    from claude_agent_sdk import ResultMessage
    s.open_turns = 1
    await s._handle(ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                                  num_turns=1, session_id="sid"))
    assert s.status == "done" and notes == ["approval", "done"]


async def ask_session(monkeypatch, transcripts):
    texts = iter(transcripts)

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.01)
    events = []

    async def emit(ev):
        events.append(ev)

    s = FolderSession("/x", "k1", Store(), emit, lambda: False)
    s.open_turns = 1
    q = {"question": "Which deploy?", "options": [{"label": "Deploy latest main"}, {"label": "Cancel"}]}
    decision = asyncio.create_task(s._can_use_tool("AskUserQuestion", {"questions": [q]}, Ctx()))
    await asyncio.sleep(0.01)
    return s, decision, events


async def test_saying_an_option_answers_the_question(monkeypatch):
    s, decision, events = await ask_session(monkeypatch, ["Deploy latest main."])
    await s.voice.utterance(b"1")
    result = await asyncio.wait_for(decision, 1)
    assert result.behavior == "allow"
    assert result.updated_input["answers"] == {"Which deploy?": "Deploy latest main"}
    done = [e for e in events if e["type"] == "permission_done"][0]
    assert done["answers"] == {"Which deploy?": "Deploy latest main"} and done["heard"] == "Deploy latest main."


async def test_yes_cannot_answer_a_multiple_choice_question(monkeypatch):
    s, decision, events = await ask_session(monkeypatch, ["Yes."])
    await s.voice.utterance(b"1")
    await asyncio.sleep(0.05)
    assert not decision.done()
    assert [e["text"] for e in events if e["type"] == "held"] == ["Yes."]
    await s.answer_permission(next(iter(s.pending)), False)
    await decision


async def test_clicked_choice_is_reported_on_the_card(monkeypatch):
    s, decision, events = await ask_session(monkeypatch, [])
    await s.answer_permission(next(iter(s.pending)), True, {"Which deploy?": "Cancel"})
    result = await asyncio.wait_for(decision, 1)
    assert result.updated_input["answers"] == {"Which deploy?": "Cancel"}
    assert [e["answers"] for e in events if e["type"] == "permission_done"] == [{"Which deploy?": "Cancel"}]


def test_vocabulary_prompt_is_short_and_has_the_names(tmp_path):
    from orb.vocab import MAX_CHARS, build_prompt
    extra = tmp_path / "v.txt"
    extra.write_text("# mine\nVikunja\n")
    p = build_prompt(["acme/billing-api", "acme/shop_web", "x/" + "y" * 40], extra)
    assert p.startswith("Claude, Opus, Sonnet") and "Vikunja" in p and "shop_web" in p
    assert "yyyy" not in p and len(p) <= MAX_CHARS



async def test_undo_flow_by_voice(monkeypatch):
    texts = iter(["Yes."])

    async def fake_transcribe(wav):
        return next(texts)

    monkeypatch.setattr(agent.speech, "transcribe", fake_transcribe)
    monkeypatch.setattr(VoiceInput, "HOLD", 0.01)
    events = []

    async def emit(ev):
        events.append(ev)

    s = FolderSession("/x", "k1", Store(), emit, lambda: False)
    rewound = []

    class Client:
        async def rewind_files(self, uid):
            rewound.append(uid)

    async def ensure():
        s.client = Client()

    monkeypatch.setattr(s, "ensure_client", ensure)
    s.turns = {"u1": {"uuid": "chk-1", "files": {"/x/a.py", "/x/b.py"}, "undone": False}}
    await s.send("Cofnij to.", "voice")  # trigger: opens the confirm card, nothing goes to Claude
    card = [e for e in events if e["type"] == "undo_confirm"][0]
    assert card["files"] == ["/x/a.py", "/x/b.py"] and "not undone" in card["note"]
    await s.voice.utterance(b"1")  # "Yes."
    await asyncio.sleep(0.05)
    assert rewound == ["chk-1"]
    done = [e for e in events if e["type"] == "undo_done"][0]
    assert done["ok"] and done["heard"] == "Yes."
    await s.send("undo that", "text")  # already undone: nothing left
    assert any(e["type"] == "notice" and "Nothing to undo" in e["text"] for e in events)


def test_undo_trigger():
    from orb.agent import UNDO_TRIGGER
    for t in ("Undo that.", "undo", "Cofnij to", "cofnij ostatnie zmiany!"):
        assert UNDO_TRIGGER.match(t), t
    for t in ("undo the migration in prod and redeploy", "Can you undo the last commit?", "cofnij się do wersji 2"):
        assert not UNDO_TRIGGER.match(t), t



async def test_undo_card_lists_later_changes_and_expires_on_new_request(monkeypatch):
    events = []

    async def emit(ev):
        events.append(ev)

    s = FolderSession("/x", "k1", Store(), emit, lambda: False)

    async def ensure():
        s.client = None

    monkeypatch.setattr(s, "ensure_client", ensure)
    s.turns = {"u1": {"uuid": "c1", "files": {"/x/a.py"}, "undone": False},
               "u2": {"uuid": "c2", "files": {"/x/b.py"}, "undone": False}}
    await s.request_undo("u1")
    card = [e for e in events if e["type"] == "undo_confirm"][0]
    assert card["files"] == ["/x/a.py", "/x/b.py"] and "Later requests" in card["note"]

    async def no_send(*a, **k):
        raise AssertionError("not reached")
    s.open_turns = 0
    await s.drop_undo_card("a new request was sent")
    assert s.undo_card is None
    assert [e for e in events if e["type"] == "undo_done"][-1]["error"].startswith("expired")


def test_lost_tasks_are_launches_with_no_notification():
    from types import SimpleNamespace as M
    from orb.agent import lost_tasks
    msgs = [
        M(message={"content": [{"type": "tool_use", "id": "a1", "name": "Agent", "input": {"description": "Slash commands"}},
                               {"type": "tool_use", "id": "b1", "name": "Bash", "input": {"description": "Run tests"}},
                               {"type": "tool_use", "id": "r1", "name": "Read", "input": {"file_path": "x"}}]}),
        M(message={"content": [{"type": "tool_result", "tool_use_id": "a1", "content": [{"type": "text", "text": "Async agent launched successfully."}]},
                               {"type": "tool_result", "tool_use_id": "b1", "content": "Command running in background with ID: bx1"},
                               {"type": "tool_result", "tool_use_id": "r1", "content": "file text"}]}),
    ]
    assert lost_tasks(msgs) == ["Slash commands", "Run tests"]
    done = M(message={"content": "<task-notification>\n<task-id>bx1</task-id>\n<tool-use-id>b1</tool-use-id>\n<status>completed</status>"})
    assert lost_tasks([*msgs, done]) == ["Slash commands"]


async def test_blocked_slash_commands_never_reach_claude_code():
    events = []

    async def emit(ev):
        events.append(ev)

    s = FolderSession("/x", "k1", Store(), emit, lambda: False)
    for text in ("/config permissionMode=acceptEdits", "/Usage-Credits", "/extra-usage", "/auto-mode-setup"):
        await s.send(text, "text")
    assert s.client is None and not s.turns
    assert [e["type"] for e in events] == ["notice"] * 4
    assert "this repo's settings" in events[0]["text"] and "whole account" in events[1]["text"]


async def test_browser_speech_sends_text_not_audio(monkeypatch):
    from orb.settings import settings
    monkeypatch.setitem(settings.data, "tts", "browser")

    async def no_kokoro(*a, **k):
        raise AssertionError("Kokoro must not be called with browser speech")

    monkeypatch.setattr(agent.speech, "synthesize", no_kokoro)
    events = []

    async def emit(ev):
        events.append(ev)

    sp = agent.Speaker(emit, lambda: True)
    sp.say(["First sentence.", "Second one."])
    for _ in range(50):
        await asyncio.sleep(0.01)
        if len([e for e in events if e["type"] == "audio"]) == 2:
            break
    clips = [e for e in events if e["type"] == "audio"]
    assert [c["text"] for c in clips] == ["First sentence.", "Second one."]
    assert all(c["speak"] and "data" not in c for c in clips)
    sp.task.cancel()


async def test_browser_recognition_text_joins_the_request(monkeypatch):
    monkeypatch.setattr(VoiceInput, "HOLD", 0.01)
    s = FakeSession()
    v = VoiceInput(s)
    v.speech_start()
    await v.text("  check the   failing test ")
    await asyncio.sleep(0.05)
    assert s.sent == ["check the failing test"]


async def test_browser_recognition_on_speakers_never_answers_a_card(monkeypatch):
    s, decision, calls, events = await card_session(monkeypatch, [])
    await s.voice.text("Yes, allow it.")  # default: possible echo of her own "Allow …?"
    await asyncio.sleep(0.05)
    assert not decision.done() and [e["text"] for e in events if e["type"] == "held"] == ["Yes, allow it."]
    await s.voice.text("Yes.", echo_risk=False)  # headphones: a real answer
    await asyncio.sleep(0.05)
    assert decision.done()
