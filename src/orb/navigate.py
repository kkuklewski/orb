"""Voice navigation: the `open_screen(destination, item?)` tool on the in-process `orb` MCP server.

Every session has it, since speech goes to whichever session is on screen. It is read-only and pre-allowed (no
card). The model maps what the owner said ("pokaż sesje", "open ready", "otwórz notatkę X", "open the last run of
inspire") onto a destination and an item; `resolve` checks both against what exists and builds the `navigate`
event the pages showing that session follow. Anything it can't find is refused with a line the model says, and
nothing moves. The words below are the glossary's (GLOSSARY.md), in Polish and English: the tool description
lists them, so a new glossary word is a new word the tool understands. "Chat" never navigates.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from . import home, tracker
from .desk import Sources
from .handoff import SERVER

NAME = "open_screen"
TOOL = f"mcp__{SERVER}__{NAME}"

DESTINATIONS = ("home", "sessions", "brain", "tasks", "routines", "settings")
LABELS = {"home": "Home", "sessions": "Sessions", "brain": "Brain", "tasks": "Tasks", "routines": "Routines", "settings": "Settings"}

# destination -> the words that name it (English, then Polish)
DESTINATION_WORDS = {
    "home": ("home", "needs you", "next action", "up next", "don't forget", "start", "strona główna", "potrzebuje cię"),
    "sessions": ("sessions", "running now", "finished", "ready", "delegated", "queued", "sesje", "sesja",
                 "działa teraz", "skończone", "gotowe", "delegowane", "w kolejce"),
    "brain": ("brain", "second brain", "notes", "note", "verdict", "mózg", "drugi mózg", "notatki", "notatka"),
    "tasks": ("tasks", "task", "vikunja", "jira", "zadania", "zadanie"),
    "routines": ("routines", "routine", "run", "runs", "rutyny", "rutyna", "przebieg"),
    "settings": ("settings", "ustawienia"),
}
# a state word said on its own ("open ready") -> (destination, the item it stands for)
STATE_WORDS = {
    "running now": ("sessions", "running now"), "running": ("sessions", "running now"), "waiting": ("sessions", "running now"),
    "działa teraz": ("sessions", "running now"), "działające": ("sessions", "running now"), "czekające": ("sessions", "running now"),
    "finished": ("sessions", None), "skończone": ("sessions", None),
    "ready": ("sessions", "ready"), "gotowe": ("sessions", "ready"),
    "delegated": ("sessions", "ready"), "delegowane": ("sessions", "ready"), "queued": ("sessions", "ready"), "w kolejce": ("sessions", "ready"),
    "needs you": ("home", None), "potrzebuje cię": ("home", None), "next action": ("home", None), "up next": ("home", None),
    "don't forget": ("home", None),
}
ROUTINE_STATES = ("failed", "stuck", "missed", "needs you", "worth reading", "nothing to report", "off",
                  "nieudane", "utknęło", "pominięte", "warte przeczytania", "nic do zgłoszenia", "wyłączone")
NOT_A_PLACE = ("chat", "home chat", "czat", "rozmowa")


def _words(xs) -> str:
    return ", ".join(f'"{x}"' for x in xs)


DESCRIPTION = (
    "Move the owner's page to a screen of Orb. Use it when they ask to show, open or go to one (\"pokaż sesje\", "
    "\"open ready\", \"otwórz notatkę X\", \"open the last run of inspire\"); it needs no approval. `destination` is "
    "one of " + ", ".join(DESTINATIONS) + ". Words that name them: "
    + "; ".join(f"{d}: {_words(w)}" for d, w in DESTINATION_WORDS.items()) + ". "
    "`item` (optional) opens one thing there: sessions: a session by repo and its first request (\"orb fix login\"), "
    "or a state: \"running now\" (running or waiting), \"ready\"; brain: a note waiting for a verdict, by title; tasks: "
    "a tracker task (Vikunja or Jira) by number or title; routines: a routine by name (its page shows the last run), or a routine state "
    "(" + _words(ROUTINE_STATES) + ") for the list. Home and Settings take no item. "
    "\"Chat\" (" + _words(NOT_A_PLACE) + ") is not a screen: the owner is already talking to you, so never call this "
    "for it. If the call is refused, say why in one short line; the page stays where it is."
)

PROMPT = f"""\
# Moving the page
When the owner asks to see a screen or an item ("pokaż sesje", "open tasks", "otwórz notatkę X", "open the last
run of inspire"), call `{NAME}`. Don't describe the screen afterwards: a word or two at most ("Done." / "Już.").
Never call it for "chat": the owner is already talking to you."""


class NavigateError(Exception):
    """Refused: the text goes back to the model, which says it; nothing moves."""


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s).replace("ł", "l").replace("Ł", "L"))
    s = "".join(c for c in s if not unicodedata.combining(c)).casefold()
    return " ".join(re.sub(r"[^\w']+", " ", s).split())


_DEST = {norm(w): d for d, ws in DESTINATION_WORDS.items() for w in ws} | {d: d for d in DESTINATIONS}
_STATE = {norm(w): v for w, v in STATE_WORDS.items()}
_ROUTINE_STATES = {norm(w) for w in ROUTINE_STATES}
_NOT_A_PLACE = {norm(w) for w in NOT_A_PLACE}


def _pick(kind: str, query: str, rows: list[tuple[str, object]]):
    """The one row `query` names: an exact name first, then the one whose name holds every word."""
    q = norm(query)
    first = lambda xs: list({id(r): (name, r) for name, r in reversed(xs)}.values())[::-1]  # noqa: E731  one per row
    exact = first([(name, r) for name, r in rows if norm(name) == q])
    hits = exact or first([(name, r) for name, r in rows if all(w in norm(name) for w in q.split())])
    if len(hits) == 1:
        return hits[0][1]
    if not hits:
        raise NavigateError(f"No {kind} matches {query!r}. Tell the owner in one short line; the page stays where it is.")
    names = [name for name, _ in hits][:6]
    raise NavigateError(f"{query!r} matches several: {'; '.join(names)}. Ask the owner which one; the page stays where it is.")


def _event(destination: str, where: str, **item) -> tuple[dict, str]:
    ev = {"type": "navigate", "destination": destination, "running": bool(item.get("running")),
          "folder": item.get("folder"), "session": item.get("session"), "note": item.get("note"),
          "task": item.get("task"), "routine": item.get("routine")}
    return ev, where


def _session(src: Sources, item: str) -> tuple[dict, str]:
    vault = src.vault()
    rows, repos = [], {}
    for f in src.folders():
        if vault and Path(f["path"]) == vault:  # the Home chat is never a row in Sessions
            continue
        names = {str(f.get("label") or "").rsplit("/", 1)[-1], Path(f["path"]).name}  # not the owner: every repo has it
        repos[f["path"]] = norm(" ".join(names))
        seen = set()
        for s in sorted(src.sessions(f["path"]), key=lambda s: s.get("last_used") or 0, reverse=True):
            label = s.get("label") or "New session"
            if s.get("archived") or label in seen:  # the same request twice: the newest one
                continue
            seen.add(label)
            rows.append((f"{f['label']} · {label}", (f, s, repos[f["path"]] + " " + norm(label))))
    q = norm(item).split()
    match = [(name, r) for name, r in rows if all(w in r[2] for w in q)]
    paths = {r[0]["path"] for _, r in match}
    if len(paths) == 1 and all(w in repos[next(iter(paths))] for w in q):  # just the repo: its newest session
        match = match[:1]
    if not match:
        raise NavigateError(f"No session matches {item!r}. Tell the owner in one short line; the page stays where it is.")
    if len(match) > 1:
        raise NavigateError(f"{item!r} matches several sessions: {'; '.join(n for n, _ in match[:6])}. "
                            "Ask the owner which one; the page stays where it is.")
    f, s, _ = match[0][1]
    return _event("sessions", f"Sessions › {f['label']} · {s.get('label') or 'New session'}", folder=f["path"], session=s["key"])


def _note(src: Sources, item: str) -> tuple[dict, str]:
    vault = src.vault()
    if not vault:
        raise NavigateError("No notes folder is set, so there are no notes to open.")
    notes = home.awaiting_notes(vault)
    n = _pick("note waiting for a verdict", item, [(x["title"], x) for x in notes] + [(Path(x["file"]).stem, x) for x in notes])
    return _event("brain", f"Brain › {n['title']}", note=n["file"])


def _task(src: Sources, item: str) -> tuple[dict, str]:
    try:
        tasks = tracker.open_tasks(src.cfg())["tasks"]
    except tracker.ERRORS as e:
        raise NavigateError(f"{tracker.name(src.cfg())} not reachable: {e}") from e
    num = re.fullmatch(r"#?\s*(\d+)", item.strip())
    if num:
        t = next((x for x in tasks if x["id"] == int(num.group(1))), None)
        if t is None:
            raise NavigateError(f"No open task #{num.group(1)}. Tell the owner in one short line; the page stays where it is.")
    else:
        t = _pick("open task", item, [(x["title"], x) for x in tasks])
    return _event("tasks", f"Tasks › #{t['id']} {t['title']}", task=str(t["id"]))


def _routine(src: Sources, item: str) -> tuple[dict, str]:
    items = src.routines()
    if items is None:
        raise NavigateError("The Routines panel is off (Settings).")
    r = _pick("routine", item, [(x["name"], x) for x in items])
    return _event("routines", f"Routines › {r['name']}", routine=r["id"])


def resolve(src: Sources, destination: str, item: str | None = None) -> tuple[dict, str]:
    """(the navigate event, "Destination › item" for the model) or NavigateError."""
    d, it = norm(destination or ""), (item or "").strip()
    if d in _NOT_A_PLACE or norm(it) in _NOT_A_PLACE:
        raise NavigateError("Chat is not a screen: the owner is already talking to you. Don't move the page.")
    if d in _STATE and not it:
        d, it = _STATE[d][0], _STATE[d][1] or ""
    dest = _DEST.get(d)
    if dest is None:
        raise NavigateError(f"No screen called {destination!r}. The screens are: {', '.join(DESTINATIONS)}.")
    if not it:
        return _event(dest, LABELS[dest])
    if dest in ("home", "settings"):
        raise NavigateError(f"{LABELS[dest]} has no items; call it without one.")
    if dest == "sessions":
        state = _STATE.get(norm(it))
        if state and state[0] == "sessions":
            if state[1] == "running now":
                return _event("sessions", "Sessions › Running now", running=True)
            if state[1] == "ready":
                raise NavigateError("Nothing is Ready: no delegation has a tested pull request up. Say so; the page stays where it is.")
            return _event("sessions", LABELS["sessions"])
        return _session(src, it)
    if dest == "brain":
        return _note(src, it)
    if dest == "tasks":
        return _task(src, it)
    if norm(it) in _ROUTINE_STATES:
        return _event("routines", LABELS["routines"])
    return _routine(src, re.sub(r"^(the )?(last )?runs? of ", "", it, flags=re.I))
