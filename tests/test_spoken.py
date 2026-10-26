import pytest

from orb.spoken import (
    VOICE_PROMPT,
    TextBlockRouter,
    TurnState,
    clean_for_speech,
    read_all_sentences,
    route_whole,
    split_spoken,
)

REFERENCE = """<spoken>I couldn't deploy from here, because this session has no SSH access to the server. \
I wrote the three steps in the chat.</spoken>

Nie uruchomiłem deployu. `deploy.sh` wysyła katalog przez `rsync --delete`.

## 1. Deploy z Twojego komputera

```bash
cd ~/repo
git checkout squad-matcher
./scripts/deploy.sh
```

- **Konflikt przy merge:** zatrzymaj się.
- **Komendy:** `npm run deploy-commands` nie jest potrzebne.

| Krok | Co |
| --- | --- |
| 1 | deploy |
"""


def stream(chunks, turn=None, with_said=False):
    r = TextBlockRouter(turn)
    display, speech, said = "", [], ""
    for c in chunks:
        out = r.feed(c)
        display += out.display
        speech += out.speech
        said += out.said
    out = r.finish()
    res = (display + out.display, speech + out.speech)
    return (*res, (said + out.said).strip()) if with_said else res


def every_split(text):
    """All two-chunk splits of text."""
    return [[text[:i], text[i:]] for i in range(1, len(text))]


def test_spoken_part_is_spoken_and_shown_apart_from_the_written_answer():
    display, speech, said = stream([REFERENCE], with_said=True)
    assert speech == [
        "I couldn't deploy from here, because this session has no SSH access to the server.",
        "I wrote the three steps in the chat.",
    ]
    assert said.startswith("I couldn't deploy from here") and said.endswith("in the chat.")
    assert "<spoken>" not in display and "</spoken>" not in display
    assert "couldn't deploy" not in display  # the written answer does not repeat the summary
    assert display.strip().startswith("Nie uruchomiłem deployu.")
    assert "git checkout squad-matcher" in display


def test_prompt_tells_the_model_not_to_repeat_the_summary():
    assert "must not repeat" in VOICE_PROMPT


def test_split_spoken_of_a_stored_answer():
    assert split_spoken("<spoken>Done. All good.</spoken>\n\n## Details\nx") == ("Done. All good.", "## Details\nx")
    assert split_spoken("<spoken>Only this.</spoken>") == ("Only this.", "")
    assert split_spoken("No tags here.") == ("", "No tags here.")


@pytest.mark.parametrize("chunks", every_split("<spoken>Hello there. All done.</spoken>\n\n# Next\n- a"))
def test_tag_cut_across_two_deltas(chunks):
    display, speech, said = stream(chunks, with_said=True)
    assert speech == ["Hello there.", "All done."]
    assert said == "Hello there. All done."
    assert "<" not in display
    assert display.strip() == "# Next\n- a"


def test_streams_sentence_by_sentence_before_close_tag():
    r = TextBlockRouter()
    assert r.feed("<spoken>First sentence here. Sec").speech == ["First sentence here."]
    assert r.feed("ond one.</spoken>").speech == ["Second one."]


def test_fallback_speaks_first_prose_only_max_three_sentences():
    text = "One is here. Two is here. Three is here. Four is here.\n\nMore prose."
    assert route_whole(text).speech == ["One is here.", "Two is here.", "Three is here."]


def test_fallback_stops_at_first_structure():
    text = "I checked the repo. It looks fine.\n\n## Steps\nNot this.\n\n1. nor this"
    assert route_whole(text).speech == ["I checked the repo.", "It looks fine."]


@pytest.mark.parametrize(
    "structure",
    ["```bash\nrm -rf build\n```", "- deploy now\n- then test", "1. deploy now", "| a | b |\n|---|---|", "# Heading"],
)
def test_code_lists_tables_never_reach_tts(structure):
    # Neither as fallback, nor when the model wrongly puts them inside <spoken>.
    for text in (structure + "\n\nSome prose after.", f"<spoken>{structure}\nPlain words.</spoken>"):
        speech = " ".join(route_whole(text).speech)
        for word in ("rm", "deploy", "| a", "Heading", "test"):
            assert word not in speech, (text, speech)


def test_inline_code_read_as_plain_word_and_paths_urls_dropped():
    s = clean_for_speech("Run `make test` in ~/code/orb, see https://example.com/x now.")
    assert s == "Run make test in, see now."
    assert clean_for_speech("Edit **src/app.py** and `orb/server.py`.") == "Edit and."


def test_untagged_progress_notes_silent_after_a_spoken_part():
    turn = TurnState()
    stream(["<spoken>Looking into it now.</spoken> Checking files."], turn)
    _, speech = stream(["Let me read the config next."], turn)
    assert speech == []


def test_untagged_block_without_any_tag_uses_fallback():
    _, speech = stream(["Let me read ", "the config next. Then more."])
    assert speech == ["Let me read the config next.", "Then more."]


def test_literal_less_than_is_kept():
    display, speech, said = stream(["<spoken>Use a < b here.</spoken>"], with_said=True)
    assert said == "Use a < b here." and display == ""
    assert speech == ["Use a b here."]


def test_abbreviations_do_not_split():
    _, speech = stream(["<spoken>Use a tool, e.g. ruff, for this. Done now.</spoken>"])
    assert speech == ["Use a tool, e.g. ruff, for this.", "Done now."]


def test_read_all_speaks_prose_headings_and_items_but_no_code_or_tables():
    speech = read_all_sentences(REFERENCE)
    joined = " ".join(speech)
    assert "I couldn't deploy from here" in joined
    assert "Deploy z Twojego komputera" in joined
    assert "Konflikt przy merge: zatrzymaj się." in joined
    assert "git checkout" not in joined and "Krok" not in joined
