import asyncio
from types import SimpleNamespace

from orb import speech


def test_warm_tts_runs_at_most_once_a_minute(monkeypatch):
    calls = []

    async def fake(text, voice=None):
        calls.append(text)
        raise RuntimeError("kokoro down")  # errors are swallowed

    monkeypatch.setattr(speech, "synthesize", fake)
    monkeypatch.setattr(speech, "_last_warm", float("-inf"))
    monkeypatch.setattr(speech, "settings", SimpleNamespace(settings={"voice": "af_sky", "tts": "kokoro"}))

    async def go():
        speech.warm_tts()
        speech.warm_tts()
        await asyncio.sleep(0)
        await asyncio.gather(*speech._warm_tasks, return_exceptions=True)

    asyncio.run(go())
    assert calls == ["Hi."]
