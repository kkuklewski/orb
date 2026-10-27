import asyncio
import json
import re

from orb import needs, protocol

TODAY = "2026-10-25"
ROUTINES = [
    {"id": "r1", "name": "Mail check", "enabled": True, "needs": "action", "why": "account alert",
     "last": {"id": "run1", "outcome": "ok", "summary": "Acme will close the account unless you log in"}},
    {"id": "r2", "name": "Quiet job", "enabled": True, "needs": None, "why": "", "last": {"id": "run2", "outcome": "ok"}},
    {"id": "r3", "name": "Off", "enabled": False, "needs": "failed", "why": "", "last": None},
    {"id": "r4", "name": "Backup", "enabled": True, "needs": "failed", "why": "", "last": {"id": "run4", "outcome": "failed"}},
]
TASKS = [
    {"id": 7, "title": "Fix checkout", "project": "acme", "due": "2026-10-20", "priority": 2, "url": "http://v/tasks/7"},
    {"id": 8, "title": "Due today", "project": "acme", "due": TODAY, "priority": 5, "url": "http://v/tasks/8"},
    {"id": 9, "title": "Send invoice", "project": "globex", "due": "2026-10-24", "priority": 0, "url": "http://v/tasks/9"},
    {"id": 10, "title": "Someday", "project": "", "due": None, "priority": 0, "url": "http://v/tasks/10"},
]


def rules():
    return needs.needs_you(ROUTINES, TASKS, TODAY)


def keys(rows):
    return [r["key"] for r in rows]


def test_rules_take_routine_problems_worst_first_then_tasks_due_before_today():
    assert keys(rules()) == ["routine:r4", "routine:r1", "vikunja:7", "vikunja:9"]  # not r2 (fine), r3 (off), 8 (due today), 10
    late = rules()[2]
    assert (late["kind"], late["id"], late["source"], late["due"], late["reason"]) == ("task", "7", "acme", "2026-10-20", "Was due 5 days ago (2026-10-20).")
    assert rules()[3]["reason"] == "Was due yesterday."
    assert rules()[0]["title"] == "Routine ‘Backup’ failed" and rules()[1]["reason"].startswith("Acme will close")


SIGNED_IN = {"installed": True, "loggedIn": True}
UP = {"whisper": True, "kokoro": True}


def problems(auth=SIGNED_IN, error=None, stt="browser", tts="browser", health=UP, parakeet=True):
    return [p["id"] for p in needs.setup_problems(auth, error, stt, tts, health, parakeet)]


def test_a_broken_setup_needs_you_first_and_names_the_settings_section_that_fixes_it():
    assert problems() == []
    assert problems(auth={}) == []  # not checked yet: no verdict
    assert problems(auth={"installed": True, "loggedIn": False}) == ["claude"]
    assert problems(auth={"installed": False, "loggedIn": False}) == ["claude"]
    assert problems(error="Vikunja not reachable: didn't answer: down") == ["vikunja"]
    down = {"whisper": False, "kokoro": False}
    assert problems(health=down) == []  # only the engines the owner chose count
    assert problems(stt="whisper", tts="kokoro", health=down) == ["speech", "voice"]
    assert problems(stt="parakeet", health=down, parakeet=False) == ["speech"]
    assert problems(stt="parakeet", health=down) == []

    setup = needs.setup_problems({"installed": True, "loggedIn": False}, "Vikunja not reachable: refused", "browser", "browser", UP, True)
    rows = needs.needs_you(ROUTINES, TASKS, TODAY, setup)
    assert keys(rows)[:3] == ["setup:claude", "setup:vikunja", "routine:r4"]
    assert (rows[0]["kind"], rows[0]["id"], rows[0]["title"], rows[0]["actions"]) == ("setup", "claude", "Claude Code is signed out", ["open"])
    assert rows[1]["reason"] == "Vikunja not reachable: refused"
    for r in rows:
        protocol.PlanItem.model_validate({k: r[k] for k in needs.SENT})


def test_a_reminder_needs_you_from_its_day_on_not_before():
    due = [{"text": "Renew acme.example", "due": TODAY, "days": 0, "url": "https://registrar.example/acme"},
           {"text": "Globex contract", "due": "2026-10-23", "days": -2, "url": None},
           {"text": "Tomorrow's thing", "due": "2026-10-26", "days": 1, "url": None}]
    rows = needs.needs_you(ROUTINES, TASKS, TODAY, reminders=due)
    assert keys(rows) == ["routine:r4", "routine:r1", "reminder:2026-10-23:Globex contract",
                          f"reminder:{TODAY}:Renew acme.example", "vikunja:7", "vikunja:9"]
    old, today = rows[2], rows[3]
    assert (old["kind"], old["reason"], old["actions"], old["url"]) == ("reminder", "Was due 2 days ago (2026-10-23).", [], None)
    assert (today["reason"], today["actions"], today["url"]) == ("Due today.", ["open"], "https://registrar.example/acme")
    protocol.PlanItem.model_validate({k: today[k] for k in needs.SENT})


def test_the_prompt_says_approve_or_reject():
    text = needs.queue([], [], [], [], 3, TODAY)[0]["facts"]
    assert "approve or reject" in text and "read or reject" not in text


def test_fingerprint_changes_with_the_facts_and_the_day():
    base = needs.fingerprint(rules(), TODAY)
    assert needs.fingerprint(needs.needs_you(ROUTINES, TASKS, TODAY), TODAY) == base
    assert needs.fingerprint(rules(), "2026-10-26") != base
    rerun = [{**ROUTINES[0], "last": {**ROUTINES[0]["last"], "id": "run9"}}, *ROUTINES[1:]]
    assert needs.fingerprint(needs.needs_you(rerun, TASKS, TODAY), TODAY) != base


def test_prompt_fences_items_and_shows_only_short_ids():
    text, ids = needs.prompt(rules(), TODAY)
    tag = text.split("<item-")[1].split(" ")[0]
    assert text.count(f"</item-{tag}>") == len(ids) == 4 and "untrusted" in text and TODAY in text
    assert "routine:r4" not in text and set(ids) == {"i1", "i2", "i3", "i4"}


def test_parse_keeps_known_ids_once_in_order():
    ids = {"i1": "routine:r1", "i2": "vikunja:7"}
    reply = 'ok {"items": [{"id": "i2", "why": " pay  it "}, {"id": "i9", "why": "x"}, {"id": "i2", "why": "dupe"}, {"id": "i1", "why": "log in"}]}'
    assert needs.parse(reply, ids) == [{"key": "vikunja:7", "why": "pay it"}, {"key": "routine:r1", "why": "log in"}]
    for bad in ("no json", '{"items": 3}'):
        try:
            needs.parse(bad, ids)
            raise AssertionError("should fail")
        except ValueError:
            pass


def ranker(replies):
    sent, asked = [], []

    async def ask(prompt):
        asked.append(prompt)
        r = replies[min(len(asked), len(replies)) - 1]
        if isinstance(r, Exception):
            raise r
        return r

    async def push(ev):
        protocol.PlanEvent.model_validate(ev)
        sent.append(ev)

    return sent, asked, ask, push


# The model reorders, drops one, invents one and repeats one: it can't add or drop a needs-you item.
WILD = ('{"items": [{"id": "i3", "why": "the client waits on checkout"}, {"id": "i99", "why": "made up"},'
        ' {"id": "i2", "why": "log in before it closes"}, {"id": "i3", "why": "again"}]}')


def test_a_ranking_only_reorders_and_explains_the_rule_items(tmp_path):
    sent, asked, ask, push = ranker([WILD])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0))
    first, last = sent[0], sent[-1]
    assert keys(first["needs_you"]) == ["routine:r4", "routine:r1", "vikunja:7", "vikunja:9"] and first["busy"] and first["stale"]
    assert keys(last["needs_you"]) == ["vikunja:7", "routine:r1", "routine:r4", "vikunja:9"]  # ranked, then the rest in rule order
    assert [r["reason"] for r in last["needs_you"][:2]] == ["the client waits on checkout", "log in before it closes"]
    assert last["needs_you"][2]["reason"] == "Its last run failed." and not last["stale"] and last["ranked_at"] == 1000.0
    assert "facts" not in last["needs_you"][0] and len(asked) == 1


def test_a_new_problem_shows_at_once_in_rule_order_without_waiting_for_the_model(tmp_path):
    sent, asked, ask, push = ranker([WILD])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0))
    broke = [*ROUTINES, {"id": "r5", "name": "Deploy", "enabled": True, "needs": "stuck", "why": "", "last": {"id": "run5"}}]
    asyncio.run(n.update(TODAY, routines=broke, now=1100.0))  # tasks kept from the last update; too soon to ask again
    ev = sent[-1]
    assert len(asked) == 1 and ev["stale"] and not ev["busy"]
    assert keys(ev["needs_you"]) == ["routine:r4", "routine:r5", "routine:r1", "vikunja:7", "vikunja:9"]
    assert ev["needs_you"][3]["reason"] == "the client waits on checkout"  # its facts didn't change: the reason stays
    asyncio.run(n.update(TODAY, routines=broke, now=1100.0 + needs.MIN_GAP))
    assert len(asked) == 2


def test_a_failed_ranking_leaves_the_rule_order_and_says_why(tmp_path):
    sent, asked, ask, push = ranker([RuntimeError("down")])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0))
    ev = sent[-1]
    assert ev["error"].startswith("Couldn't rank") and ev["stale"] and keys(ev["needs_you"]) == keys(rules())
    assert ev["needs_you"][2]["reason"] == "Was due 5 days ago (2026-10-20)."


def test_update_asks_once_per_change_and_the_ranking_survives_a_restart(tmp_path):
    sent, asked, ask, push = ranker([WILD])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0))
    asyncio.run(n.update(TODAY, tasks=TASKS, now=1100.0))  # nothing changed
    assert len(asked) == 1
    asyncio.run(n.update(TODAY, force=True, now=1200.0))  # Re-rank
    assert len(asked) == 2
    again = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(again.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1300.0))
    assert len(asked) == 2 and keys(sent[-1]["needs_you"])[0] == "vikunja:7"


def test_nothing_at_all_asks_nothing(tmp_path):
    sent, asked, ask, push = ranker([WILD])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=None, tasks=[], now=1000.0))
    ev = sent[-1]
    assert asked == [] and ev["needs_you"] == [] and ev["next"] is None and ev["up_next"] == [] and not ev["stale"]


# -- the queue: next action and Up next ---------------------------------------------------------------------------

NOTES = [{"text": "Write the globex offer", "file": "work/Globex.md", "line": 4, "mtime": 500.0, "raw": "- [ ] Write the globex offer"}]
RESULTS = [{"key": "s1", "label": "fix the login", "repo": "acme", "last_used": 900.0}]
PRS = [{"repo": "acme/web", "number": 12, "title": "Faster search", "url": "http://gh/12", "updated": 800.0, "idle_days": 3, "draft": False},
       {"repo": "acme/web", "number": 13, "title": "WIP", "url": "http://gh/13", "updated": 950.0, "idle_days": 0, "draft": True}]
MORE = [*TASKS, {"id": 11, "title": "Suggested high", "project": "acme", "due": None, "priority": 0, "suggested": 4, "created": "2026-10-01T10:00:00Z"},
        {"id": 12, "title": "Due next week", "project": "globex", "due": "2026-10-30", "priority": 1}]


def plan(**kw):
    return needs.queue(kw.get("tasks", MORE), NOTES, RESULTS, PRS, kw.get("awaiting", 12), TODAY, kw.get("hidden", set()))


def test_the_queue_is_in_rule_order_due_then_priority_then_newest():
    q = plan()
    # due today, due 10-30, then undated: priority 4 (suggested), then newest first (result 900, PR 800, note 500, task 10, batch)
    assert keys(q) == ["vikunja:8", "vikunja:12", "vikunja:11", "result:s1", "pr:acme/web#12", "note:work/Globex.md:4", "vikunja:10", "notes:pending"]
    assert "vikunja:7" not in keys(q) and "pr:acme/web#13" not in keys(q)  # overdue needs you; a draft isn't asked for
    by = {c["key"]: c for c in q}
    assert by["vikunja:8"]["reason"] == "Due today." and by["vikunja:12"]["reason"] == "Due in 5 days (2026-10-30)."
    assert by["vikunja:11"]["reason"] == "Priority 4 (suggested)." and by["vikunja:11"]["priority"] == 4
    assert by["notes:pending"]["title"] == "12 notes wait for a verdict" and by["notes:pending"]["kind"] == "notes_batch"
    assert by["result:s1"]["id"] == "s1" and by["note:work/Globex.md:4"]["id"] == "work/Globex.md:4"
    # Done is offered only on tasks (Vikunja's and the notes'); everything can be started or put off
    assert {c["key"] for c in q if "done" in c["actions"]} == {"vikunja:8", "vikunja:12", "vikunja:11", "vikunja:10", "note:work/Globex.md:4"}
    assert all(c["actions"][0] == "start" and "later" in c["actions"] for c in q)


def test_the_notes_batch_is_one_item_with_the_count_and_gone_at_zero():
    assert [c["title"] for c in plan(awaiting=1) if c["kind"] == "notes_batch"] == ["1 note waits for a verdict"]
    assert not [c for c in plan(awaiting=0) if c["kind"] == "notes_batch"]


def order(*words):
    """A model that puts the items whose facts hold these words first, in this order, with a reason each."""
    def reply(text):
        items = re.findall(r'<item-\w+ id="(i\d+)">\n(.*?)\n</item-', text, re.S)
        picks = [next(i for i, facts in items if w in facts) for w in words]
        return json.dumps({"items": [{"id": i, "why": f"because {w}"} for i, w in zip(picks, words)]})
    return reply


def smart(*replies):
    sent, asked = [], []

    async def ask(text):
        asked.append(text)
        return replies[min(len(asked), len(replies)) - 1](text)

    async def push(ev):
        protocol.PlanEvent.model_validate(ev)
        sent.append(ev)

    return sent, asked, ask, push


FACTS = dict(routines=ROUTINES, tasks=MORE, notes=NOTES, results=RESULTS, prs=PRS, awaiting=12)


def test_the_models_first_pick_leads_and_the_rest_merge_by_rule_order(tmp_path):
    sent, asked, ask, push = smart(order("Faster search", "globex offer"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    assert "QUEUE:" in asked[0] and asked[0].index("NEEDS YOU:") < asked[0].index("QUEUE:")
    first, ev = sent[0], sent[-1]
    assert first["next"]["key"] == "vikunja:8" and len(first["up_next"]) == needs.UP_NEXT  # rule order while it ranks
    assert ev["next"]["key"] == "pr:acme/web#12" and ev["next"]["reason"] == "because Faster search"
    assert keys(ev["up_next"]) == ["vikunja:8", "vikunja:12", "vikunja:11", "result:s1", "note:work/Globex.md:4"]  # its 2nd pick by rule
    assert keys(ev["needs_you"]) == keys(rules())  # it ranked no needs-you item: those keep the rule order


def test_a_new_item_joins_up_next_in_rule_order_and_never_replaces_the_next_action(tmp_path):
    sent, asked, ask, push = smart(order("Faster search"), order("Due next week"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    assert sent[-1]["next"]["key"] == "pr:acme/web#12"
    urgent = [*MORE, {"id": 20, "title": "Call the bank", "project": "", "due": TODAY, "priority": 5, "created": "2026-10-25T08:00:00Z"}]
    asyncio.run(n.update(TODAY, tasks=urgent, now=1100.0))  # too soon to ask again
    ev = sent[-1]
    assert len(asked) == 1 and ev["stale"] and ev["next"]["key"] == "pr:acme/web#12"
    assert keys(ev["up_next"])[:2] == ["vikunja:20", "vikunja:8"]  # due today, priority 5, newest: right behind the next action
    asyncio.run(n.update(TODAY, force=True, now=1200.0))  # a new ranking may move it
    assert sent[-1]["next"]["key"] == "vikunja:12" and not sent[-1]["stale"]


def test_the_next_action_holds_after_a_restart_until_it_is_gone(tmp_path):
    sent, asked, ask, push = smart(order("Faster search"))
    asyncio.run(needs.Needs(tmp_path / "n.json", ask, push).update(TODAY, now=1000.0, **FACTS))
    again = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(again.update(TODAY, now=1100.0, **FACTS))
    assert sent[-1]["next"]["key"] == "pr:acme/web#12" and len(asked) == 1
    asyncio.run(again.update(TODAY, prs=[], now=1200.0))  # merged: the next item moves up
    assert sent[-1]["next"]["key"] == "vikunja:8"


def test_an_opened_result_leaves_the_queue(tmp_path):
    sent, asked, ask, push = smart(order("fix the login"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    assert sent[-1]["next"]["key"] == "result:s1"
    asyncio.run(n.update(TODAY, results=[], now=1100.0))
    ev = sent[-1]
    assert "result:s1" not in keys([ev["next"], *ev["up_next"]]) and ev["next"]["key"] == "vikunja:8"


def test_a_started_item_leaves_the_queue_for_today_and_on_every_restart(tmp_path):
    sent, asked, ask, push = smart(order("Faster search"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    asyncio.run(n.mark("started", "pr:acme/web#12", TODAY))
    assert sent[-1]["next"]["key"] == "vikunja:8"
    again = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(again.update(TODAY, now=1100.0, **FACTS))
    assert "pr:acme/web#12" not in keys([sent[-1]["next"], *sent[-1]["up_next"]])
    asyncio.run(again.update("2026-10-26", now=1100.0 + needs.MIN_GAP, **FACTS))  # a new day: it is back
    assert "pr:acme/web#12" in keys([sent[-1]["next"], *sent[-1]["up_next"]])


def test_later_hides_an_item_until_the_next_day_on_every_restart_and_writes_nothing_else(tmp_path):
    sent, asked, ask, push = smart(order("Faster search"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    assert sent[-1]["next"]["key"] == "pr:acme/web#12"
    asyncio.run(n.mark("later", "pr:acme/web#12", TODAY))
    assert sent[-1]["next"]["key"] == "vikunja:8" and "pr:acme/web#12" not in keys(sent[-1]["up_next"])
    again = needs.Needs(tmp_path / "n.json", ask, push)  # a server restart
    asyncio.run(again.update(TODAY, now=1100.0, **FACTS))
    assert "pr:acme/web#12" not in keys([sent[-1]["next"], *sent[-1]["up_next"]])
    asyncio.run(again.update("2026-10-26", now=1100.0 + needs.MIN_GAP, **FACTS))
    assert "pr:acme/web#12" in keys([sent[-1]["next"], *sent[-1]["up_next"]])


def test_done_hides_a_task_and_its_undo_brings_it_back(tmp_path):
    sent, asked, ask, push = smart(order("Due today"))
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, now=1000.0, **FACTS))
    asyncio.run(n.mark("done", "vikunja:8", TODAY))
    assert "vikunja:8" not in keys([sent[-1]["next"], *sent[-1]["up_next"]])
    asyncio.run(n.mark("done", "vikunja:8", TODAY, on=False))
    assert "vikunja:8" in keys([sent[-1]["next"], *sent[-1]["up_next"]])


def test_a_notes_task_key_finds_the_line_it_guards(tmp_path):
    n = needs.Needs(tmp_path / "n.json", None, None)
    n.facts["notes"] = NOTES
    assert n.note("note:work/Globex.md:4")["raw"] == "- [ ] Write the globex offer"
    assert n.note("note:work/Globex.md:5") is None and n.note("vikunja:8") is None


def test_only_a_broken_setup_and_an_urgent_routine_are_urgent():
    setup = needs.setup_problems({"installed": True, "loggedIn": False}, None, "browser", "browser", UP, True)
    routines = [ROUTINES[0], {**ROUTINES[3], "urgent": True}]
    rows = needs.needs_you(routines, TASKS, TODAY, setup, [{"text": "Renew", "due": TODAY}])
    assert {r["key"]: r["urgent"] for r in rows} == {
        "setup:claude": True, "routine:r4": True, "routine:r1": False, f"reminder:{TODAY}:Renew": False, "vikunja:7": False, "vikunja:9": False}
    assert rows[1]["facts"].startswith("Urgent. ")  # the ranking model sees it too


# -- pinned rows, the since clock and red at ESCALATE_H (docs/adr/0012) ------------------------------------------------

H = 3600.0
SECURE = {"id": "r6", "name": "Login watch", "enabled": True, "needs": "action", "why": "account alert", "security": True,
          "last": {"id": "run6", "outcome": "ok", "summary": "Someone signed in to acme from a new place"}}
CLIENT = {**TASKS[2], "client": True}  # Send invoice, due 2026-10-24, in a client folder's repo


def pinned_rules():
    return needs.needs_you([*ROUTINES, SECURE], [TASKS[0], CLIENT, TASKS[1]], TODAY)


def test_a_rule_pins_security_routines_setup_and_client_tasks_only():
    setup = needs.setup_problems({"installed": True, "loggedIn": False}, None, "browser", "browser", UP, True)
    rows = needs.needs_you([*ROUTINES, SECURE], [TASKS[0], CLIENT], TODAY, setup, [{"text": "Renew", "due": TODAY}])
    assert {r["key"]: r["pin"] for r in rows} == {
        "setup:claude": "security", "routine:r4": None, "routine:r1": None, "routine:r6": "security",
        f"reminder:{TODAY}:Renew": None, "vikunja:7": None, "vikunja:9": "client"}


def test_pinned_rows_lead_with_no_ranking_a_stale_one_and_a_fresh_one_ordering_inside_each_block(tmp_path):
    items = pinned_rules()  # rule order: r4, r1, r6 (pinned), vikunja:7, vikunja:9 (pinned)
    assert keys(needs.ordered(items, [], False)) == ["routine:r6", "vikunja:9", "routine:r4", "routine:r1", "vikunja:7"]
    ranking = [{"key": k, "why": "", "stable": ""} for k in ("vikunja:7", "vikunja:9", "routine:r1", "routine:r6", "routine:r4")]
    assert keys(needs.ordered(items, ranking, True)) == ["vikunja:9", "routine:r6", "vikunja:7", "routine:r1", "routine:r4"]
    assert keys(needs.ordered(items, ranking, False)) == ["routine:r6", "vikunja:9", "routine:r4", "routine:r1", "vikunja:7"]
    sent, asked, ask, push = ranker(['{"items": [{"id": "i5", "why": "a"}, {"id": "i1", "why": "b"}]}'])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=[*ROUTINES, SECURE], tasks=[TASKS[0], CLIENT], now=1000.0))
    assert keys(sent[-1]["needs_you"]) == ["vikunja:9", "routine:r6", "routine:r4", "routine:r1", "vikunja:7"]
    assert [r["pin"] for r in sent[-1]["needs_you"]] == ["client", "security", None, None, None]
    assert keys(n.needs_rows()) == keys(sent[-1]["needs_you"])  # the Away recap's top 3 reads the same order


def test_the_since_clock_starts_on_entry_drops_on_leaving_restarts_on_return_and_survives_a_restart(tmp_path):
    sent, asked, ask, push = ranker([RuntimeError("down")])
    path = tmp_path / "n.json"
    n = needs.Needs(path, ask, push)
    setup = [{"id": "vikunja", "title": "Vikunja isn't reachable", "reason": "timeout"}]
    asyncio.run(n.update(TODAY, routines=ROUTINES, setup=setup, now=1000.0))
    since = json.loads(path.read_text())["since"]
    assert since == {"routine:r4": 1000.0, "routine:r1": 1000.0, "setup:vikunja": 1000.0}
    assert "ranking" in json.loads(path.read_text())  # one file, saved with the ranking
    asyncio.run(n.update(TODAY, routines=[ROUTINES[3]], now=2000.0))  # r1 left Needs you
    assert json.loads(path.read_text())["since"] == {"routine:r4": 1000.0, "setup:vikunja": 1000.0}
    asyncio.run(n.update(TODAY, routines=ROUTINES, now=3000.0))  # r1 is back: a new clock
    assert json.loads(path.read_text())["since"]["routine:r1"] == 3000.0
    again = needs.Needs(path, ask, push)  # a restart: routines and setup not sent yet, the clocks stay
    asyncio.run(again.update(TODAY, tasks=TASKS, now=4000.0))
    assert json.loads(path.read_text())["since"] == {"routine:r4": 1000.0, "routine:r1": 3000.0, "setup:vikunja": 1000.0}
    asyncio.run(again.update(TODAY, routines=ROUTINES, setup=[], now=5000.0))  # setup fixed: its clock goes
    assert json.loads(path.read_text())["since"] == {"routine:r4": 1000.0, "routine:r1": 3000.0}


def test_red_at_48h_a_routine_by_its_clock_a_task_only_when_pinned_too():
    items = needs.needs_you([ROUTINES[0]], [TASKS[0], CLIENT, {**TASKS[2], "id": 19, "client": True, "due": "2026-10-23"}], TODAY)
    red = lambda hours: {c["key"]: c["urgent"] for c in needs.aged(items, {"routine:r1": 0.0}, TODAY, hours * H)}  # noqa: E731
    assert red(47) == {"routine:r1": False, "vikunja:7": False, "vikunja:9": False, "vikunja:19": True}
    assert red(48)["routine:r1"] is True
    # Fix checkout is 5 days late and stays grey; Send invoice (pinned) is 1 day late; vikunja:19 (pinned) 2 days = 48h.
    assert not red(10_000)["vikunja:7"] and not red(10_000)["vikunja:9"]
    assert needs.ESCALATE_H == 48


def test_the_badge_count_is_the_same_with_and_without_age_or_pins(tmp_path):
    plain = needs.needs_you(ROUTINES, TASKS, TODAY)
    pinned = needs.needs_you([*ROUTINES[:3], {**ROUTINES[3], "security": True}], [{**t, "client": True} for t in TASKS], TODAY)
    old = needs.aged(pinned, {"routine:r1": 0.0, "routine:r4": 0.0}, TODAY, 1000 * H)
    assert len(plain) == len(pinned) == len(old) == len(needs.ordered(old, [], False))


def test_a_day_passing_keeps_the_fingerprint_and_the_reasons_and_the_model_reads_the_age(tmp_path):
    sent, asked, ask, push = ranker([WILD, WILD])
    n = needs.Needs(tmp_path / "n.json", ask, push)
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0))
    fp = n.state["fp"]
    asyncio.run(n.update(TODAY, routines=ROUTINES, tasks=TASKS, now=1000.0 + 30 * H + needs.MIN_GAP))
    assert len(asked) == 1 and n.state["fp"] == fp and not sent[-1]["stale"]
    assert sent[-1]["needs_you"][0]["reason"] == "the client waits on checkout"
    assert "in Needs you for 0 days" in asked[0] and "in Needs you for 5 days" in asked[0]  # r4 just entered; vikunja:7 was due 10-20
    aged = needs.aged(n.items, n.state["since"], TODAY, 1000.0 + 30 * H)
    assert [c["stable"] for c in aged] == [c["stable"] for c in n.items]
    assert "in Needs you for 1 day" in aged[0]["facts"] and "facts" not in sent[-1]["needs_you"][0]
