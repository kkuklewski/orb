"""Home's Email card: the mail routine's first section, one row per email, urgent by rule."""

import asyncio
import datetime as dt
import time

from orb import emails, protocol
from orb.routines import Watch
from orb.settings import settings as live

DAY = dt.date(2026, 11, 7)

# The shape RemoteTrigger hands over: newlines folded, the tail cut off.
FOLDED = ("**Morning cleanup summary (7 Nov 2026)** **(a) Needs your attention today** - **Urgent:** Acme Telecom "
          "(bills@acme.test) says 25.02 PLN is due Monday 9 Nov on account 1234. I sent you an alert. - Globex Bank "
          "sent a \"thank you for payment\" on 6 Nov. Worth a quick check. - Two invoice PDFs need a manual download: "
          "Initech and Acme Telecom. - The flight price changed on your tracked trip (17 Dec to 2 Jan). "
          "**(b) Counts** - Labeled 21 threads. - Auto/Finance: 9 … [+989 chars]")


def test_the_attention_section_becomes_one_row_per_bullet():
    rows, cut = emails.rows(FOLDED, DAY, DAY)
    assert [r["text"][:12] for r in rows] == ["Acme Telecom", "Globex Bank ", "Two invoice ", "The flight p"]
    assert not cut  # the cut was in "(b) Counts", after the list
    assert rows[0]["urgent"] and rows[0]["due"] == "2026-11-09" and rows[0]["text"].startswith("Acme Telecom (bills")
    assert not any(r["urgent"] for r in rows[1:]) and rows[1]["due"] is None  # "on 6 Nov" is not a due date
    assert "Labeled" not in " ".join(r["text"] for r in rows)


def test_markdown_with_lines_and_a_hash_heading_works_too():
    text = "## Urgent\n- [URGENT] Initech: confirm the contract\n- Globex: pay the invoice by 2026-11-10\n- Acme: answer before 30 Dec\n\n## Counts\n- 3 labeled"
    rows, _ = emails.rows(text, DAY, DAY)
    assert [(r["urgent"], r["due"]) for r in rows] == [(True, None), (True, "2026-11-10"), (False, "2026-12-30")]


def test_a_list_cut_short_says_so_and_a_near_year_end_date_takes_the_next_year():
    text = "**Needs you** - Acme: renew the domain by Jan 3 - Globex: the contract renewal is waiti… [+400 chars]"
    rows, cut = emails.rows(text, dt.date(2026, 12, 30), dt.date(2026, 12, 30))
    assert cut and rows[0]["due"] == "2027-01-03" and rows[0]["urgent"]


def test_no_attention_section_means_no_rows():
    assert emails.rows("No new email today.", DAY, DAY) == ([], False)
    assert emails.rows("**Summary** - labeled 4 threads - nothing else", DAY, DAY)[0] == []


def test_a_sentence_dash_is_not_a_bullet():
    rows, _ = emails.rows("**Action needed** - Acme - the vendor - wants an answer. - Globex: sign it", DAY, DAY)
    assert [r["text"] for r in rows] == ["Acme - the vendor - wants an answer.", "Globex: sign it"]


def _item(id="trig_1", name="Gmail cleanup", detail=FOLDED, run="cse_1", needs=None, enabled=True):
    at = time.mktime(DAY.timetuple()) + 6 * 3600
    return {"id": id, "name": name, "enabled": enabled, "needs": needs,
            "last": {"id": run, "at": at, "outcome": "ok", "detail": detail}}


def test_the_card_reads_only_mail_routines_and_leaves_done_rows_out():
    now = time.mktime(DAY.timetuple()) + 9 * 3600
    items = [_item(), _item(id="trig_2", name="night-backlog", run="cse_2"), _item(id="trig_3", name="Inbox mail", enabled=False, run="cse_3")]
    rows = emails.card(items, {}, now)
    assert len(rows) == 4 and {r["routine"] for r in rows} == {"trig_1"} and rows[0]["urgent"]
    done = {"cse_1": [rows[0]["key"]]}
    assert len(emails.card(items, done, now)) == 3
    assert emails.card(items, {}, now)[0] == protocol.EmailRow(**rows[0]).model_dump()  # the event's shape


def test_the_setting_names_the_mail_routines(monkeypatch):
    monkeypatch.setitem(live.data, "email_routines", ["etihad"])
    assert emails.is_mail("Daily Etihad check") and not emails.is_mail("Gmail cleanup")
    monkeypatch.setitem(live.data, "email_routines", [])
    assert not emails.is_mail("Gmail cleanup")


def test_done_on_the_last_row_resolves_the_runs_action(tmp_path, monkeypatch):
    async def push():
        return None

    async def notify(_t):
        return None

    w = Watch(tmp_path / "routines.json", notify, push)
    w.state["routines"] = {"trig_1": {"id": "trig_1", "name": "Gmail cleanup"}}
    w.state["runs"] = {"trig_1": [{"id": "cse_1"}]}  # kept runs: Done marks of other runs are trimmed on save
    x = _item(detail="**Needs your attention** - **Urgent:** Acme: pay by 9 Nov. - Globex: reply")
    monkeypatch.setattr(w, "items", lambda: [{**x, "needs": "action" if x["id"] not in w.state["resolved"] else None}])
    keys = [r["key"] for r in emails.card(w.items(), {}, time.time())]
    asyncio.run(w.email_done("cse_1", "not-a-key"))
    asyncio.run(w.email_done("cse_9", keys[0]))  # no such run: nothing
    assert w.state["email_done"] == {}
    asyncio.run(w.email_done("cse_1", keys[0]))
    assert w.state["email_done"] == {"cse_1": [keys[0]]} and "trig_1" not in w.state["resolved"]
    asyncio.run(w.email_done("cse_1", keys[1]))
    assert w.state["resolved"]["trig_1"] == "cse_1"
