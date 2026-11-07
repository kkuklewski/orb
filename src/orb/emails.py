"""Home's Email card (GLOSSARY: Email card): the emails a mail routine's newest run says need you, one row each.

Orb reads no mailbox (docs/adr/0015). A mail routine (a claude.ai routine whose name holds one of
settings["email_routines"], default "mail") reads the inbox on claude.ai and writes a summary. Its first section
headed like "Needs your attention", "Urgent" or "Action" lists the emails that need you, one bullet each. RemoteTrigger
keeps only about the first thousand characters of a result, newlines folded into spaces, so that list must come first;
a list cut short says so (`cut`), and the run's screen has the rest.

Rules, no model: a row is urgent when its bullet starts with "Urgent" (or says [URGENT]), or names a due date ("due",
"by", "before", "until", "deadline" + a date) within routines.URGENT_DAYS or already past. The text quotes email, so it
is untrusted: the page shows it as plain text, and Done keeps only a hash of it, per run (state "email_done").

Open in Gmail is a link only (docs/adr/0015): a bullet may carry the email's thread id ("[gmail:<hex id>]", hidden from
the row), else the link searches for the sender's address the bullet names. Orb still never touches the mailbox.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import urllib.parse

from . import routines, settings

_CUT = re.compile(r"\s*…?\s*\[\+\d+ chars\]\s*$")  # RemoteTrigger's mark on a result it shortened
_BOLD = re.compile(r"\*\*([^*\n]{1,100}?)\*\*")
_HASH_HEAD = re.compile(r"^#{1,4} +(.{1,100})$", re.M)
_ATTENTION = re.compile(r"attention|urgent|action|needs? (?:you|me)|important|to ?do\b|pilne|wymaga", re.I)
# A bullet starts the section, a line, or follows the end of a sentence: " - " inside a sentence isn't one.
_BULLET = re.compile(r"(?:^|\n|(?<=[.!?)\]\"'”…:]) )[ \t]*(?:[-•–]|\d{1,2}[.)]) +")
_URGENT_LEAD = re.compile(r"^\s*(?:\[urgent\]|urgent|pilne)\s*[:!—–-]?\s*", re.I)
_URGENT_TAG = re.compile(r"\[urgent\]", re.I)
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
_DATE = rf"(\d{{4}}-\d{{2}}-\d{{2}})|(\d{{1,2}})(?:st|nd|rd|th)? {_MON}|{_MON} (\d{{1,2}})(?:st|nd|rd|th)?\b"
_DUE = re.compile(rf"\b(?:due|by|before|until|deadline)\b[^.;!?]{{0,24}}?\b(?:{_DATE})", re.I)
TEXT_MAX = 300  # chars of one row's text
# "[gmail:18f3a2b4c5d6e7f8]" (or "(thread 18f3…)") on a bullet: the email's Gmail thread id, which the routine may add
_THREAD = re.compile(r"\s*[\[(]\s*(?:gmail|thread)(?:\s*id)?\s*[:#]?\s*([0-9a-f]{12,20})\s*[\])]", re.I)
_ADDR = re.compile(r"(?<![\w.+-])[\w.+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+", re.I)
_ACCOUNT = re.compile(r"^(?:\d{1,2}|[\w.+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)$", re.I)


def gmail_link(thread: str | None, text: str) -> str | None:
    """A link to the email in Gmail, by rule: its thread when the bullet names one, else a search for the first address
    the bullet names; None with neither. Built only from those checked pieces (the text is untrusted), always
    mail.google.com; settings["gmail_account"] (an address or an account number) picks the account, else the first."""
    if thread:
        frag = f"all/{thread.lower()}"
    elif m := _ADDR.search(text):
        frag = "search/" + urllib.parse.quote(f"from:{m.group(0).lower()}", safe="")
    else:
        return None
    account = str(settings.settings["gmail_account"] or "").strip()
    if account and _ACCOUNT.match(account) and not account.isdigit():
        base = "https://mail.google.com/mail/?authuser=" + urllib.parse.quote(account, safe="")
    else:
        base = f"https://mail.google.com/mail/u/{account if account.isdigit() else 0}/"
    return f"{base}#{frag}"


def is_mail(name: str) -> bool:
    """A mail routine: its name holds one of settings["email_routines"] (case-insensitive)."""
    n = name.casefold()
    return any(w.casefold() in n for w in settings.settings["email_routines"])


def _headings(text: str) -> list[tuple[int, int, str]]:
    """(start, end, title) of each heading: a bold run that doesn't lead a bullet, or a "#" line."""
    out = []
    for m in _BOLD.finditer(text):
        before = text[:m.start()].rstrip(" \t")
        if before.endswith(("-", "•", "–")) or re.search(r"(?:^|\s)\d{1,2}[.)]$", before):
            continue  # "- **Urgent:** …": a bullet's own label
        out.append((m.start(), m.end(), m.group(1)))
    out += [(m.start(), m.end(), m.group(1)) for m in _HASH_HEAD.finditer(text)]
    return sorted(out)


def section(text: str) -> tuple[str, bool]:
    """(the attention section's body, whether the result was cut short); ("", cut) when it has none."""
    cut = bool(_CUT.search(text))
    text = _CUT.sub("", text)
    heads = _headings(text)
    for i, (_s, end, title) in enumerate(heads):
        if _ATTENTION.search(title):
            stop = heads[i + 1][0] if i + 1 < len(heads) else len(text)
            return text[end:stop].strip(), cut and stop == len(text)
    return "", cut


def _due(text: str, ref: dt.date) -> str | None:
    """The first due date the text names, as YYYY-MM-DD; a day and month take the year that puts them nearest `ref`."""
    m = _DUE.search(text)
    if not m:
        return None
    iso, day1, mon1, mon2, day2 = m.groups()
    try:
        if iso:
            return dt.date.fromisoformat(iso).isoformat()
        day, mon = int(day1 or day2), _MONTHS.index((mon1 or mon2).lower()[:3]) + 1
        d = dt.date(ref.year, mon, day)
    except ValueError:
        return None
    if (d - ref).days < -180:
        d = d.replace(year=ref.year + 1)
    elif (d - ref).days > 180:
        d = d.replace(year=ref.year - 1)
    return d.isoformat()


def key(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).casefold().encode()).hexdigest()[:16]


def rows(text: str, ref: dt.date, today: dt.date) -> tuple[list[dict], bool]:
    """([{key, text, urgent, due}], cut) for one run's result, in the run's order."""
    body, cut = section(text)
    parts = [p.strip() for p in _BULLET.split(body)] if body else []
    out = []
    for p in parts:
        raw = re.sub(r"\s+", " ", p.replace("**", "")).strip()
        thread = (m := _THREAD.search(raw)) and m.group(1)
        raw = _THREAD.sub("", raw).strip()
        if len(raw) < 3:
            continue
        lead = bool(_URGENT_LEAD.match(raw))
        shown = _URGENT_LEAD.sub("", raw, count=1) if lead else raw
        due = _due(shown, ref)
        soon = (today + dt.timedelta(days=routines.URGENT_DAYS)).isoformat()
        out.append({"key": key(shown), "text": shown[:TEXT_MAX] + ("…" if len(shown) > TEXT_MAX else ""),
                    "urgent": lead or bool(_URGENT_TAG.search(shown)) or bool(due and due <= soon), "due": due,
                    "gmail": gmail_link(thread, shown)})
    return out, cut


def card(items: list[dict], done: dict[str, list[str]], now: float) -> list[dict]:
    """The Email card's rows: from each enabled mail routine's newest ok run, minus the ones marked Done; urgent first,
    then by due date, then in the run's order."""
    today = dt.date.fromtimestamp(now)
    out = []
    for x in items:
        last = x.get("last") or {}
        if not (x["enabled"] and is_mail(x["name"]) and last.get("outcome") == "ok" and last.get("detail")):
            continue
        ref = dt.date.fromtimestamp(last.get("at") or now)
        found, cut = rows(last["detail"], ref, today)
        gone = set(done.get(last["id"], []))
        for i, r in enumerate(found):
            if r["key"] not in gone:
                out.append({**r, "routine": x["id"], "routine_name": x["name"], "run": last["id"], "at": last.get("at"),
                            "cut": cut and i == len(found) - 1, "order": i})
    out.sort(key=lambda r: (not r["urgent"], r["due"] or "9999", -(r["at"] or 0), r["order"]))
    return [{k: v for k, v in r.items() if k != "order"} for r in out]


def open_rows(x: dict, done: dict[str, list[str]], now: float) -> int:
    """How many of this routine's newest-run rows are not Done yet."""
    return sum(1 for r in card([x], done, now))
