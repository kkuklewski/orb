"""Whisper vocabulary: names the user says that Whisper mishears ("Coolify" -> "Qualifier").

Sent as the `prompt` field with every transcription. A bare comma list, not a sentence, so it
doesn't push language detection towards English. Kept short: Whisper uses about 224 tokens.
"""

from __future__ import annotations

import re
from pathlib import Path

# Names every Orb user may say; their own go in ~/.orb/vocabulary.txt (Settings → Vocabulary),
# and the repo names found in their folders are added too.
SEED = ["Claude", "Opus", "Sonnet", "Haiku", "Kokoro", "Whisper", "Parakeet", "GitHub", "npm", "pytest"]
MAX_CHARS = 600


def build_prompt(folder_labels: list[str], extra_file: Path | None = None) -> str:
    words: list[str] = list(SEED)
    if extra_file is not None:
        try:
            words += [w.strip() for w in extra_file.read_text().splitlines() if w.strip() and not w.startswith("#")]
        except OSError:
            pass
    for label in folder_labels:
        name = label.rsplit("/", 1)[-1]
        if 3 <= len(name) <= 24 and not re.fullmatch(r"[\w.-]*\d{3,}[\w.-]*", name):
            words.append(name)
    seen, out, size = set(), [], 0
    for w in words:
        key = w.casefold()
        if key in seen:
            continue
        if size + len(w) + 2 > MAX_CHARS:
            break
        seen.add(key)
        out.append(w)
        size += len(w) + 2
    return ", ".join(out)
