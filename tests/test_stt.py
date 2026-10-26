import io
import wave

import pytest

from orb import parakeet, settings, speech


def wav(rate=16000, channels=1, samples=(0, 16384, -32768)):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(s.to_bytes(2, "little", signed=True) for s in samples))
    return buf.getvalue()


def test_pcm_from_wav_scales_to_unit_range():
    assert list(parakeet.pcm_from_wav(wav())) == [0.0, 0.5, -1.0]


def test_pcm_from_wav_rejects_other_formats():
    with pytest.raises(ValueError):
        parakeet.pcm_from_wav(wav(rate=48000))
    with pytest.raises(ValueError):
        parakeet.pcm_from_wav(b"not a wav")


def test_words_join_pieces_and_skip_punctuation():
    tokens = [("▁Vic", 0.4), ("anya", 0.9), (",", 0.1), ("▁yes", 0.95), (".", 0.2)]
    assert parakeet.words(tokens) == [("Vicanya", 0.4), ("yes", 0.95)]
    assert parakeet.words([]) == []


VOCAB = ["Coolify", "Vikunja", "PushMedi", "Obsidian", "Whisper", "Redragon", "Claude"]


def names():
    return {speech._letters(n): n for n in VOCAB}


@pytest.mark.parametrize("heard", [
    [("add", 0.9), ("Vicanya", 0.4)],                   # English
    [("dla", 0.9), ("Push", 0.6), ("Medii", 0.55)],     # Polish, a name split in two
    [("na", 0.9), ("co", 0.5), ("Olify", 0.6)],
    [("z", 0.9), ("Oksidiana", 0.52)],                  # Polish ending
    [("Ask", 0.9), ("Red", 0.62), ("Dragon", 0.8)],
])
def test_unsure_name_goes_to_whisper(heard):
    assert speech.sounds_like_name(heard, names())


@pytest.mark.parametrize("heard", [
    [("Hey", 0.61), ("there", 0.7), ("latest", 0.9)],   # real mic speech, nothing like a name
    [("Okay", 0.99), ("Vicanya", 0.99)],                # confident: kept even if odd
    [("from", 0.9), ("Obsidian", 0.6)],                 # the name itself, heard right
])
def test_ordinary_or_confident_words_stay(heard):
    assert speech.sounds_like_name(heard, names()) is None


def test_respell_uses_vocabulary_spelling():
    words = [("over", 0.9), ("TailScale", 0.62), ("to", 0.9), ("Obsidian", 0.6)]
    assert speech.respell("over TailScale to Obsidian.", words, {"tailskale": "Tailscale", "obsidian": "Obsidian"}) \
        == "over Tailscale to Obsidian."


class FakeEngine:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    def transcribe(self, data):
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def route(monkeypatch):
    """Patch the engine; returns a list that records Whisper calls."""
    calls = []

    async def fake_whisper(data):
        calls.append(data)
        return "whisper text"

    monkeypatch.setitem(settings.settings.data, "stt", "parakeet")
    monkeypatch.setattr(speech, "PROMPT", ", ".join(VOCAB))
    monkeypatch.setattr(speech, "transcribe_whisper", fake_whisper)

    def use(engine):
        monkeypatch.setattr(parakeet, "engine", lambda: engine)
        return calls
    return use


async def test_parakeet_text_is_used(route):
    calls = route(FakeEngine(("Hey there, what's new?", [("Hey", 0.61), ("there", 0.9), ("whats", 0.9), ("new", 0.9)])))
    assert await speech.transcribe(wav()) == "Hey there, what's new?"
    assert calls == []


async def test_misheard_name_goes_to_whisper(route):
    calls = route(FakeEngine(("add a task in Vicanya", [("add", 0.9), ("a", 0.9), ("task", 0.9), ("in", 0.9), ("Vicanya", 0.46)])))
    assert await speech.transcribe(wav()) == "whisper text"
    assert len(calls) == 1


async def test_parakeet_error_or_missing_goes_to_whisper(route):
    route(FakeEngine(error=RuntimeError("parakeet_full failed")))
    assert await speech.transcribe(wav()) == "whisper text"
    route(None)
    assert await speech.transcribe(wav()) == "whisper text"


async def test_whisper_setting_skips_parakeet(route, monkeypatch):
    calls = route(FakeEngine(("never used", [])))
    monkeypatch.setitem(settings.settings.data, "stt", "whisper")
    assert await speech.transcribe(wav()) == "whisper text"
    assert len(calls) == 1


def test_stt_setting_accepts_only_known_engines(tmp_path):
    st = settings.Settings(tmp_path / "settings.json")
    assert st.update({"stt": "whisper"})["stt"] == "whisper"
    assert st.update({"stt": "bogus"})["stt"] == "whisper"


def test_recommended_voices_only_good_ones_best_first():
    installed = ["af_sky", "af_heart", "am_adam", "bf_emma", "af_bella"]
    ids = [v["id"] for v in speech.recommended(installed)]
    assert ids == ["af_heart", "af_bella", "bf_emma"]  # graded A, A-, B-; af_sky (C-) and am_adam (F+) left out
    keep = speech.recommended(installed, current="af_sky")
    assert keep[-1]["id"] == "af_sky" and keep[-1]["grade"] is None  # a weak current voice stays selectable


def test_tts_errors_read_plainly():
    import httpx
    req = httpx.Request("POST", "http://127.0.0.1:8880/v1/audio/speech")
    bad = httpx.HTTPStatusError("400", request=req, response=httpx.Response(400, request=req))
    assert speech.tts_error(bad).startswith("Kokoro refused that voice (HTTP 400)")
    assert "isn't running" in speech.tts_error(httpx.ConnectError("refused", request=req))
