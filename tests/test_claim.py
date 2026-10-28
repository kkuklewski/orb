"""The claim (ticket 872, #866): the tracker's assignee is the lock. Delegate is refused without an identity or when a
teammate holds the task; Allow claims before the worktree; Discard takes back only an assignment Orb added; the branch
is per person."""

import pytest
from test_delegation import TASK, Rig, dev  # noqa: F401 (dev is a fixture)

from orb import claim, tracker, worktree
from orb.delegation import DelegationError

ME = {"id": "7", "name": "Acme Dev", "username": "acme-dev"}
MATE = {"id": "9", "name": "Globex Dev"}


class FakeTracker:
    """tracker.me / task / assign / unassign over one dict of assignees per task."""

    def __init__(self, monkeypatch, held=None):
        self.assignees = {7: list(held or [])}
        self.calls, self.fail_me, self.drop, self.race = [], None, False, None
        monkeypatch.setattr(tracker, "me", self.me)
        monkeypatch.setattr(tracker, "task", lambda cfg, tid: {**TASK, "id": tid, "assignees": list(self.assignees.get(tid, []))})
        monkeypatch.setattr(tracker, "assign", self.assign)
        monkeypatch.setattr(tracker, "unassign", self.unassign)

    def me(self, cfg):
        if self.fail_me:
            raise tracker.vikunja.VikunjaError(self.fail_me)
        return ME

    def assign(self, cfg, tid, uid):
        self.calls.append(("assign", tid, uid))
        if not self.drop:
            self.assignees.setdefault(tid, []).append({"id": uid, "name": ME["name"]})
        if self.race:
            self.assignees[tid].append(self.race)

    def unassign(self, cfg, tid, uid):
        self.calls.append(("unassign", tid, uid))
        self.assignees[tid] = [a for a in self.assignees[tid] if a["id"] != uid]


@pytest.fixture
def ft(monkeypatch):
    return FakeTracker(monkeypatch)


CLAIMS = claim.Claims(lambda: {"vikunja_url": "http://vikunja.test"})


def test_a_free_task_is_claimed_and_read_back(ft):
    assert CLAIMS.claim(7) is True
    assert ft.calls == [("assign", 7, "7")] and ft.assignees[7] == [{"id": "7", "name": "Acme Dev"}]


def test_a_task_already_mine_is_not_assigned_again(monkeypatch):
    ft = FakeTracker(monkeypatch, held=[{"id": "7", "name": "Acme Dev"}])
    assert CLAIMS.claim(7) is False and ft.calls == []


def test_a_teammates_task_is_refused_and_never_touched(monkeypatch):
    ft = FakeTracker(monkeypatch, held=[MATE])
    with pytest.raises(claim.ClaimError, match=r"Task #7 is held by Globex Dev\."):
        CLAIMS.claim(7)
    with pytest.raises(claim.ClaimError, match="held by Globex Dev"):
        CLAIMS.check({**TASK, "assignees": [MATE]})
    assert ft.calls == []


def test_a_race_takes_back_only_ours(ft):
    ft.race = MATE
    with pytest.raises(claim.ClaimError, match="Couldn't claim task #7: it is held by Globex Dev"):
        CLAIMS.claim(7)
    assert ft.calls == [("assign", 7, "7"), ("unassign", 7, "7")] and ft.assignees[7] == [MATE]


def test_an_assignment_the_tracker_dropped_fails(ft):
    ft.drop = True
    with pytest.raises(claim.ClaimError, match="Vikunja didn't keep the assignment"):
        CLAIMS.claim(7)


def test_no_identity_no_delegate(ft):
    ft.fail_me = "Vikunja didn't answer: down"
    with pytest.raises(claim.ClaimError, match="Orb can't tell who you are in Vikunja: Vikunja didn't answer: down"):
        CLAIMS.check(TASK)


def test_the_branch_is_per_person():
    assert worktree.branch_name(762, "Worktree apply & discard", "Acme Dev!") == "orb/acme-dev/762-worktree-apply-discard"
    assert worktree.branch_name(5, "x", "a-very-long-tracker-username-indeed") == "orb/a-very-long-tracker/5-x"
    assert worktree.branch_name(5, "x") == "orb/5-x" and worktree.branch_name(5, "x", "ąę") == "orb/5-x"


def rig_with(dev, ft):
    rig = Rig(dev)
    rig.d.claims = CLAIMS
    return rig


async def test_allow_claims_then_discard_takes_it_back(dev, ft):
    rig = rig_with(dev, ft)
    card = rig.d.card({**TASK, "assignees": []}, rig.web, "web")
    assert card["branch"] == "orb/acme-dev/7-fix-the-login-button"
    (r,) = await rig.d.confirm(card["id"], True, {"secrets"})
    await rig.settle()
    assert r["claimed"] is True and ft.calls == [("assign", 7, "7")]
    assert await rig.d.discard(r["id"]) == []
    assert ft.calls[-1] == ("unassign", 7, "7") and ft.assignees[7] == []


async def test_discard_leaves_an_assignment_orb_did_not_add(dev, monkeypatch):
    ft = FakeTracker(monkeypatch, held=[{"id": "7", "name": "Acme Dev"}])
    rig = rig_with(dev, ft)
    r = await rig.allow({**TASK, "assignees": ft.assignees[7]})
    assert r["claimed"] is False
    await rig.d.discard(r["id"])
    assert ft.calls == []


async def test_a_held_task_gets_no_card_and_a_lost_claim_makes_no_worktree(dev, monkeypatch):
    ft = FakeTracker(monkeypatch, held=[MATE])
    rig = rig_with(dev, ft)
    with pytest.raises(DelegationError, match="held by Globex Dev"):
        rig.d.card({**TASK, "assignees": [MATE]}, rig.web, "web")
    card = rig.d.card({**TASK, "assignees": []}, rig.web, "web")  # the row was stale: the claim reads it again
    with pytest.raises(DelegationError, match="held by Globex Dev"):
        await rig.d.confirm(card["id"], True, {"secrets"})
    assert rig.d.items == {} and ft.calls == []


async def test_a_failed_worktree_takes_back_the_claim(dev, ft, monkeypatch):
    rig = rig_with(dev, ft)
    card = rig.d.card({**TASK, "assignees": []}, rig.web, "web")

    def boom(*a):
        raise worktree.WorktreeError("disk full")

    monkeypatch.setattr(worktree, "create", boom)
    with pytest.raises(worktree.WorktreeError):
        await rig.d.confirm(card["id"], True, {"secrets"})
    assert ft.calls == [("assign", 7, "7"), ("unassign", 7, "7")] and rig.d.items == {}


async def test_bulk_skips_a_held_task_and_starts_the_rest(dev, ft):
    ft.assignees[8] = [MATE]
    rig = rig_with(dev, ft)
    t8 = {**TASK, "id": 8, "title": "Other", "assignees": [MATE]}
    card, skipped = rig.d.bulk([([{**TASK, "assignees": []}, t8], rig.web, "web")])
    assert skipped == ["Task #8 is held by Globex Dev."] and [x["task"] for x in card["rows"]] == [7]


def test_the_backends_assign_one_person_at_a_time(monkeypatch):
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "vt")
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "jt")
    writes = []
    monkeypatch.setattr(tracker.vikunja, "_write", lambda base, token, path, body=None, method="POST": writes.append((method, path, body)))
    monkeypatch.setattr(tracker.jira, "_call", lambda base, auth, path, params=None, body=None, method="GET": writes.append((method, path, body)))
    v, j = {"vikunja_url": "http://vikunja.test"}, {"jira_url": "https://acme.atlassian.net"}
    tracker.assign(v, 7, "3"), tracker.unassign(v, 7, "3"), tracker.assign(j, 10001, "a-1"), tracker.unassign(j, 10001, "a-1")
    assert writes == [("PUT", "/tasks/7/assignees", {"user_id": 3}), ("DELETE", "/tasks/7/assignees/3", None),
                      ("PUT", "/issue/10001/assignee", {"accountId": "a-1"}), ("PUT", "/issue/10001/assignee", {"accountId": None})]
