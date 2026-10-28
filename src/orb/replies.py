"""Answer an approval card by voice: a short, clear yes or no.

Anything else (longer speech, a "but", words that are neither yes, no nor filler) returns None:
the caller holds it until the card is answered. A misheard reply must never deny by accident,
and must never approve something the user qualified ("yes, but first …").
"""

from __future__ import annotations

import re

MAX_WORDS = 6

YES = {
    "yes", "yeah", "yep", "yup", "ya", "yea", "approve", "approved", "allow", "allowed", "go", "sure",
    "ok", "okay", "okey", "proceed", "absolutely", "definitely", "affirmative",
    "tak", "dawaj", "zatwierdź", "zatwierdz", "zatwierdzam", "jasne", "pewnie", "można", "mozna",
    "dobra", "śmiało", "smialo", "akceptuj", "akceptuję", "akceptuje",
    "permitted", "granted", "pozwalam", "zezwalam", "zgoda", "wolno", "pozwól", "pozwol",
}
NO = {
    "no", "nope", "nah", "deny", "denied", "stop", "don't", "dont", "cancel", "reject", "negative",
    "nie", "odrzuć", "odrzuc", "odrzucam", "stój", "stoj", "anuluj", "przestań", "przestan",
}
# Words that may surround a yes or no without changing it.
FILLER = {
    "you", "can", "it", "please", "do", "ahead", "that's", "thats", "that", "is", "fine", "good", "right",
    "all", "thanks", "thank", "of", "course", "mhm", "uh", "um", "oh", "the", "this", "one", "run",
    "sounds", "great", "perfect", "i", "mean", "so", "well", "just", "go", "on",
    "you're", "youre", "are", "it's", "its", "we're", "i'm", "im", "let's", "lets", "a",
    "możesz", "mozesz", "proszę", "prosze", "to", "jest", "w", "porządku", "porzadku", "dobrze",
    "rób", "rob", "tego", "zrób", "zrob", "ok", "dzięki", "dzieki",
}


def classify_reply(text: str) -> str | None:
    """'allow', 'deny' or None (not a clear, short yes or no)."""
    words = re.findall(r"[\w']+", text.lower().replace("’", "'"))
    if not words or len(words) > MAX_WORDS:
        return None
    yes = any(w in YES for w in words)
    no = any(w in NO for w in words)
    if any(w not in YES | NO | FILLER for w in words):
        return None  # something else was said: hold it, don't guess
    if yes and not no:
        return "allow"
    if no and not yes:
        return "deny"
    return None


_ORDINALS = {
    0: ("first", "1", "pierwsza", "pierwszy", "pierwsze", "jeden", "jedynka"),
    1: ("second", "two", "2", "druga", "drugi", "drugie", "dwa", "dwójka"),
    2: ("third", "three", "3", "trzecia", "trzeci", "trzecie", "trzy", "trójka"),
    3: ("fourth", "four", "4", "czwarta", "czwarty", "czwarte", "cztery", "czwórka"),
}


def match_option(text: str, labels: list[str]) -> int | None:
    """Index of the option the user named ("Deploy latest main", "the second one"), or None.

    A plain yes/no never picks an option: multiple-choice questions need a choice.
    """
    words = re.findall(r"[\w']+", text.lower())
    if not words:
        return None
    # "option 2", "the second one", "druga opcja"
    if len(words) <= 4:
        hits = {i for i, names in _ORDINALS.items() if i < len(labels) and any(w in names for w in words)}
        if len(hits) == 1:
            return hits.pop()
    scores = []
    for i, label in enumerate(labels):
        key = [w for w in re.findall(r"[\w']+", label.lower()) if len(w) > 2] or re.findall(r"[\w']+", label.lower())
        if not key:
            scores.append(0.0)
            continue
        scores.append(sum(1 for w in key if w in words) / len(key))
    best = max(scores, default=0.0)
    if best >= 0.6 and scores.count(best) == 1:
        return scores.index(best)
    return None
