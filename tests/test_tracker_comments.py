"""Tracker comments (ticket 874, #866 Q6): Allow says "Delegated with Orb on <host>, branch <branch>." on the task, a new
PR says "PR #N: <link>"; a comment that fails is logged, the strip says so, and the delegation goes on. The host name is
never in the PR."""

import pytest
from test_claim import CLAIMS, TASK, FakeTracker, rig_with
from test_delegation import Rig, dev, gh, remote  # noqa: F401 (fixtures)

from orb import delegation, tracker


class Comments:
    def __init__(self, monkeypatch) -> None:
        self.said: list[tuple[int, str]] = []
        self.fail = ""
        monkeypatch.setattr(tracker, "comment", self.comment)
        monkeypatch.setattr(delegation.socket, "gethostname", lambda: "acme-laptop")

    def comment(self, cfg, tid, text):
        if self.fail:
            raise tracker.vikunja.VikunjaError(self.fail)
        self.said.append((tid, text))


@pytest.fixture
def said(monkeypatch):
    FakeTracker(monkeypatch)
    return Comments(monkeypatch)


async def test_allow_says_where_it_runs_and_the_pr_says_its_link(dev, remote, gh, said):
    rig = rig_with(dev, None)
    rig.store.set_command(rig.web, "test", "true")
    r = await rig.allow({**TASK, "assignees": []})
    assert said.said == [(7, f"Delegated with Orb on acme-laptop, branch {r['branch']}.")]
    await rig.turn({"d.txt": "delegated\n"})
    await rig.d.outward(r["id"], True)
    await rig.settle()
    assert said.said[1:] == [(7, "PR #12: https://git.example/acme/web/pull/12")]
    ((_, _, title, body),) = gh.calls
    assert "acme-laptop" not in title + body
    await rig.d.discard(r["id"])
    assert len(said.said) == 2  # nothing on Discard


async def test_a_failed_comment_is_named_on_the_strip_and_the_delegation_goes_on(dev, said):
    said.fail = "Vikunja didn't answer: down"
    rig = rig_with(dev, None)
    r = await rig.allow({**TASK, "assignees": []})
    row = rig.row()
    assert row["stage"] == "working" and r["id"] in rig.d.items
    assert row["line"].endswith(" · tracker comment not posted")


async def test_no_tracker_no_comment(dev, said):
    rig = Rig(dev)
    await rig.allow()
    assert said.said == []


def test_the_backends_post_one_comment(monkeypatch):
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "vt")
    monkeypatch.setenv("ORB_JIRA_EMAIL", "dev@acme.test")
    monkeypatch.setenv("ORB_JIRA_TOKEN", "jt")
    writes = []
    monkeypatch.setattr(tracker.vikunja, "_write", lambda base, token, path, body=None, method="POST": writes.append((method, path, body)))
    monkeypatch.setattr(tracker.jira, "_call", lambda base, auth, path, params=None, body=None, method="GET": writes.append((method, path, body)))
    tracker.comment({"vikunja_url": "http://vikunja.test"}, 7, "PR #3: x")
    tracker.comment({"jira_url": "https://acme.atlassian.net"}, 10001, "PR #3: x")
    assert writes[0] == ("PUT", "/tasks/7/comments", {"comment": "PR #3: x"})
    method, path, body = writes[1]
    assert (method, path) == ("POST", "/issue/10001/comment") and body["body"]["type"] == "doc"
    assert "PR #3: x" in str(body["body"])


def test_claims_note_names_the_task_when_it_fails(monkeypatch):
    def down(cfg, tid, text):
        raise tracker.vikunja.VikunjaError("down")

    monkeypatch.setattr(tracker, "comment", down)
    with pytest.raises(Exception, match=r"Couldn't comment on task #7: down"):
        CLAIMS.note(7, "x")
