import pytest

from orb.replies import classify_reply


@pytest.mark.parametrize("text", [
    "Yeah, you can. Approve.", "Yeah, sure.", "Yes", "yes please", "Go ahead.", "Okay, do it.", "Sure, that's fine.",
    "Tak.", "Dawaj.", "Zatwierdź.", "Tak, możesz.", "Jasne, dawaj",
])
def test_short_yes_allows(text):
    assert classify_reply(text) == "allow"


@pytest.mark.parametrize("text", ["No.", "Nope", "Deny it.", "Stop.", "Don't.", "No, don't do that.", "Nie.", "Nie, nie rób tego."])
def test_short_no_denies(text):
    assert classify_reply(text) == "deny"


@pytest.mark.parametrize("text", [
    "Yes, but first check the tests.",           # qualified
    "No wait, yes.",                              # both
    "Can you explain what this command does?",    # a question, not an answer
    "Yes, and also delete the old build folder",  # long, extra instruction
    "Hmm.", "", "[BLANK_AUDIO]",
    "What's the weather like?",
    "Not yet.",
    "Tak, ale najpierw sprawdź testy.",
])
def test_anything_else_is_held_never_denied(text):
    assert classify_reply(text) is None


from orb.replies import match_option  # noqa: E402

LABELS = ["Deploy latest main", "Deploy the staging branch", "Cancel"]


@pytest.mark.parametrize("text, index", [
    ("Deploy latest main.", 0), ("latest main please", 0), ("the staging branch", 1), ("Cancel.", 2),
    ("The second one.", 1), ("option 1", 0), ("druga", 1), ("pierwsza opcja", 0),
])
def test_named_option_is_picked(text, index):
    assert match_option(text, LABELS) == index


@pytest.mark.parametrize("text", ["Yes.", "Yeah, sure.", "No.", "Deploy.", "Hmm, not sure which one."])
def test_yes_no_or_vague_never_picks(text):
    assert match_option(text, LABELS) is None
