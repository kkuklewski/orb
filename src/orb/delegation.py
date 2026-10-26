"""Delegations (ADR 0003, 0004, 0005): a Vikunja task handed to a background session in its own worktree.

Delegate raises the grant card (repo, branch, what the session may do without asking); Deny starts nothing. Allow
creates the worktree from a snapshot of the checkout, a record in `delegations.json` and a session at the worktree
that carries the grant, and sends it the task as its first request. When a turn of that session ends, Orb runs the
repo's declared test command in the worktree itself (what the session says is a claim): Ready when it passes or
none is declared, failed otherwise. Ready offers Review (the diff) and Apply; Apply stops the session, lands the
branch on the checkout's branch (a conflict changes nothing), marks the task done and removes the worktree; Undo
reverts it and reopens the task. Discard stops the session and drops the branch and worktree.
The stage line is the only status word: a delegation is never Finished.

Outward steps (#771, ADR 0004): when the tests passed and the repo has a remote, Orb (not the session) may push the
branch and open a PR with gh. The repo's outward steps setting does it at once (never in a client folder); otherwise
the delegation stays Ready and Needs you asks "Push branch X and open a PR for task #N?" (Allow, Skip, Discard). Skip
and Deny never contact the remote. A branch that starts from Orb's snapshot of uncommitted changes is never pushed.
Allow: "Opening PR", then "Ready: PR #M, tests passed"; a failure stays Ready with the branch and says why. Apply and
Undo stay local (the owner's choice): Apply merges the branch into the checkout and leaves the PR open as history.

Needs you (#772): a delegation that can't finish on its own carries `needs`, and Home lists it with the task and the
repo. "card": its session waits on a card the grant doesn't cover (the card's words come along). "failed": Orb's
check after the last turn failed (Open session, Retry, Discard; Retry sends what failed as the next request).
"stuck": Working with no event from its session for STUCK seconds (the same actions; Retry interrupts the turn
first). "stopped": the server restarted while it was working or testing; nothing resumes by itself, Resume
continues the same session in the same worktree under the same grant (unless it was revoked).

The queue (#773): at most `limit()` delegations (settings `delegation_limit`, 3) hold a slot: Working or Running tests,
not stuck. Allow past the limit still makes the worktree and the record, but the record waits as "queued" (its line
"Queued · 2nd") with its first request kept, and no session starts. When a slot frees (Ready, failed, stuck,
discarded) the oldest queued one starts. Retry and Resume take the same queue. A restart stops queued ones too.
Bulk Delegate: one grant card per repo (the tasks of that repo in a list), shown one after another; Deny skips that
repo's tasks and the next repo's card comes up either way.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from . import grant, worktree
from .brief import quoted
from .fence import Fence

log = logging.getLogger("orb.delegation")

TEST_TIMEOUT = 15 * 60
OUTPUT_MAX = 400_000
LINE_MAX = 200
RUNNING = ("working", "testing")
LIMIT = 3
STUCK = 20 * 60  # a Working delegation with no event for this long reads "Stuck 20 min"
_FAILED = re.compile(r"\b(FAIL(ED)?|ERROR|Error|failed|error)\b")


class DelegationError(Exception):
    """A delegation step refused; the message says why, in plain words."""


def brief(task: dict, branch: str, test: str) -> str:
    tests = f"Run the repo's tests (`{test}`) and fix what fails. " if test else ""
    return quoted("a task from my task tracker, delegated to you",
                  [("Task", f"#{task['id']} {task['title']}"), ("Project", task.get("project") or "-"),
                   ("Due", task.get("due")), ("Link", task.get("url"))],
                  task.get("description"),
                  f"What I want: do this task in this folder. It is a git worktree on branch {branch}, made for this "
                  "task from a snapshot of my checkout; my checkout is elsewhere and not yours to touch. Edit files "
                  f"here, {tests}then commit your work on {branch} with git add and git commit. Don't push, open a "
                  "pull request, merge or switch branches: I review and apply it myself. End with a few lines on what "
                  "you changed and anything I should check.")


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def covers(branch: str, commands: dict[str, str], outward: bool = False) -> list[str]:
    """What the grant lets the session do without asking, in the card's words."""
    out = ["Edit files in its own worktree"]
    out += [f"Run the {k} command: {c}" for k, c in commands.items() if c]
    if not any(commands.values()):
        out.append("No test or build command declared: running one asks first")
    out.append(f"git add and git commit on {branch}")
    out.append("After the tests pass, Orb pushes the branch and opens a PR (this repo's outward steps are on)" if outward
               else "Push and a PR: Orb asks you after the tests pass")
    return out


def failing_line(output: str) -> str:
    """The first line that says what failed, else the last line."""
    lines = [l.strip() for l in output.splitlines() if l.strip()]
    hit = next((l for l in lines if _FAILED.search(l)), lines[-1] if lines else "no output")
    return hit[:LINE_MAX]


PR_TIMEOUT = 120


async def open_pr(repo: str, branch: str, into: str, title: str, body: str) -> tuple[int, str]:
    """`gh pr create` for a pushed branch (no prompts): (number, link)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "gh", "pr", "create", "--head", branch, "--base", into, "--title", title, "--body", body, cwd=repo,
            env={**os.environ, "GH_PROMPT_DISABLED": "1"}, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
    except FileNotFoundError:
        raise DelegationError("gh is not installed, so no PR was opened") from None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), PR_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise DelegationError("gh pr create timed out") from None
    text = out.decode(errors="replace")
    m = re.search(r"https://\S+/pull/(\d+)", text)
    if proc.returncode != 0 or not m:
        raise DelegationError(f"gh pr create failed: {failing_line(text)}")
    return int(m.group(1)), m.group(0)


async def run_tests(path: str, cmd: str, timeout: float = TEST_TIMEOUT) -> tuple[bool, str]:
    """The repo's declared test command in the worktree (the owner typed it): (passed, first failing line)."""
    proc = await asyncio.create_subprocess_shell(cmd, cwd=path, stdout=asyncio.subprocess.PIPE,
                                                 stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL,
                                                 start_new_session=True)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return False, f"timed out after {int(timeout // 60)} min"
    text = out[-OUTPUT_MAX:].decode(errors="replace")
    return proc.returncode == 0, "" if proc.returncode == 0 else failing_line(text)


class Delegator:
    """The delegation records and their lifecycle. `session(path, key)` opens (or returns) a FolderSession,
    `push(ev)` sends to every page, `done(task, on)` writes the task done (or open) in Vikunja and the plan,
    `waiting(key)` is the words of the card that session waits on ("" when none), `limit()` how many may hold a slot."""

    def __init__(self, path: Path, *, store: Any, session: Callable[[str, str], Any],
                 push: Callable[[dict], Awaitable[None]], done: Callable[[int, bool], Awaitable[None]],
                 waiting: Callable[[str], str] = lambda key: "", limit: Callable[[], int] = lambda: LIMIT) -> None:
        self.path, self.store, self.session, self.push, self.done, self.waiting = path, store, session, push, done, waiting
        self.limit = limit
        self.cards: dict[str, dict] = {}  # open grant cards, by id
        self.jobs: set[asyncio.Task] = set()
        self.seen: dict[str, float] = {}  # the last event of each running delegation's session (this run only)
        self.stuck: set[str] = set()  # the ones the pages were last told are stuck
        self.skip: set[str] = set()  # Retry interrupted their turn: its result starts no check
        try:
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            raw = {}
        self.items: dict[str, dict] = raw.get("delegations", {}) if isinstance(raw, dict) else {}
        stopped = [r for r in self.items.values() if r["stage"] in (*RUNNING, "queued")]
        for r in stopped:  # a restart never resumes or starts one by itself
            r["stage"] = "stopped"
        cut = [r for r in self.items.values() if r["stage"] == "pushing"]
        for r in cut:  # cut while pushing: Ready, and the card asks again
            r.update(stage="ready", outward="ask")
        if stopped or cut:
            self._save()

    # -- records ------------------------------------------------------------------------------

    def _save(self) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "delegations": self.items}, indent=2))
        tmp.chmod(0o600)
        os.replace(tmp, self.path)

    def of_session(self, key: str) -> dict | None:
        return next((r for r in self.items.values() if r["session"] == key), None)

    def folder(self, path: str) -> str | None:
        """A delegation's worktree (the only way to open one: it is not in the roots)."""
        p = os.path.realpath(path)
        return p if any(r["worktree"] == p and r["stage"] not in ("applied", "reverted") for r in self.items.values()) else None

    def _get(self, rid: str) -> dict:
        r = self.items.get(rid)
        if r is None:
            raise DelegationError("That delegation is gone.")
        return r

    def _wt(self, r: dict) -> worktree.Worktree:
        wt = worktree.get(r["worktree"])
        if wt is None:
            raise DelegationError(f"The worktree for {r['branch']} is gone.")
        return wt

    def _stuck(self, r: dict) -> bool:
        return (r["stage"] == "working" and not self.waiting(r["session"])
                and time.time() - self.seen.get(r["id"], r["created"]) >= STUCK)

    def needs(self, r: dict) -> str | None:
        """Why it can't finish without the owner: "card", "failed", "stuck", "stopped", "outward" (push and PR wait
        for an OK); None while it can."""
        if r["stage"] in ("failed", "stopped"):
            return r["stage"]
        if r["stage"] == "ready" and r.get("outward") == "ask":
            return "outward"
        if r["stage"] == "working" and self.waiting(r["session"]):
            return "card"
        return "stuck" if self._stuck(r) else None

    def _queued(self) -> list[dict]:
        return sorted((r for r in self.items.values() if r["stage"] == "queued"), key=lambda r: r["queued"])

    def _free(self) -> int:
        """Slots left: Working or Running tests holds one, unless it's stuck."""
        return self.limit() - sum(r["stage"] in RUNNING and not self._stuck(r) for r in self.items.values())

    def line(self, r: dict) -> str:
        s, b = r["stage"], r["branch"]
        if s == "queued":
            return f"Queued · {ordinal(self._queued().index(r) + 1)}"
        if s == "working":
            return "Waiting for your OK" if self.waiting(r["session"]) else f"Stuck {STUCK // 60} min" if self._stuck(r) else "Working"
        if s == "testing":
            return "Running tests"
        if s == "pushing":
            return f"Pushing to PR #{r['pr']}" if r.get("pr") else "Opening PR"
        if s == "ready":
            head = f"Ready: PR #{r['pr']}, " if r.get("pr") else f"Ready: branch {b}, "
            tail = {"failed": f" · not pushed: {r.get('outward_problem')}",
                    "snapshot": " · not pushed: it starts from your uncommitted changes"}.get(r.get("outward") or "", "")
            return head + ("tests passed" if r.get("tests") == "passed" else "no tests declared") + tail
        if s == "failed":
            return r.get("problem") or "Tests failed"
        if s == "applied":
            left = f" Left behind: {', '.join(r['leftovers'])}." if r.get("leftovers") else ""
            pr = f" PR #{r['pr']} stays open." if r.get("pr") else ""
            return f"Applied to {r.get('target')}; task #{r['task']} done.{pr}{left}"
        if s == "reverted":
            return f"Reverted; task #{r['task']} reopened."
        return "Stopped by restart"

    def event(self) -> dict:
        rows = sorted(self.items.values(), key=lambda r: r["created"])  # an order that stays put
        return {"type": "delegations", "items": [
            {"id": r["id"], "task": r["task"], "title": r["title"], "repo": r["label"], "branch": r["branch"],
             "stage": r["stage"], "line": self.line(r), "session": r["session"], "folder": r["worktree"],
             "conflict": r.get("conflict"), "apply_text": self.apply_text(r), "needs": self.needs(r), "ask": self.ask(r),
             "pr": r.get("pr"), "pr_url": r.get("pr_url")}
            for r in rows]}

    def apply_text(self, r: dict) -> str:
        what = f"PR #{r['pr']}" if r.get("pr") else f"branch {r['branch']}"
        return f"Apply merges {what} and marks task #{r['task']} done."

    def ask(self, r: dict) -> str | None:
        """What it waits for the owner to allow: the card its session waits on, or the outward steps."""
        if r["stage"] == "working":
            return self.waiting(r["session"]) or None
        if self.needs(r) != "outward":
            return None
        if r.get("pr"):
            return f"Push branch {r['branch']} to PR #{r['pr']}?"
        extra = r.get("unpushed") or 0
        mine = f" {extra} of your commits not on {r['remote']}/{r['into']} go along." if extra else ""
        return f"Push branch {r['branch']} and open a PR for task #{r['task']}?{mine}"

    async def changed(self) -> None:
        self._save()
        await self.push(self.event())

    # -- Delegate -----------------------------------------------------------------------------

    def _delegated(self, task_id: int) -> bool:
        return any(r["task"] == task_id and r["stage"] not in ("applied", "reverted") for r in self.items.values())

    def card(self, task: dict, repo: str, label: str) -> dict:
        """The grant card for `task` in `repo` (an allowed folder); nothing starts until it is allowed. Runs git."""
        if self._delegated(task["id"]):
            raise DelegationError(f"Task #{task['id']} is already delegated.")
        return self._card([task], repo, label, [])

    def _card(self, tasks: list[dict], repo: str, label: str, then: list[tuple[list[dict], str, str]]) -> dict:
        worktree.current_branch(worktree.toplevel(repo))  # a repo on a branch, or no card
        rows = [{"task": t["id"], "title": t["title"], "branch": worktree.branch_name(t["id"], t["title"])} for t in tasks]
        cid = uuid.uuid4().hex
        self.cards[cid] = {"tasks": tasks, "repo": repo, "label": label, "branches": [x["branch"] for x in rows], "then": then}
        one = rows[0]
        return {"type": "delegate_card", "id": cid, "task": one["task"], "title": one["title"], "repo": label,
                "branch": one["branch"], "rows": rows, "more": len(then),
                "covers": covers(one["branch"] if len(rows) == 1 else "each task's own branch", self.store.commands(repo),
                                 self.store.outward(repo) and not Fence(repo).in_client())}

    def bulk(self, groups: list[tuple[list[dict], str, str]]) -> tuple[dict | None, list[str]]:
        """Bulk Delegate: `groups` is (tasks, repo, label) per repo, in order. The first repo's card that can be made
        (its other cards follow its answer, see `then`), and what was skipped on the way."""
        skipped: list[str] = []
        while groups:
            (tasks, repo, label), groups = groups[0], groups[1:]
            fresh = [t for t in tasks if not self._delegated(t["id"])]
            skipped += [f"Task #{t['id']} is already delegated." for t in tasks if t not in fresh]
            if not fresh:
                continue
            try:
                return self._card(fresh, repo, label, groups), skipped
            except worktree.WorktreeError as e:
                skipped.append(f"{label}: {e}")
        return None, skipped

    def then(self, cid: str) -> list[tuple[list[dict], str, str]]:
        """The repos a bulk card has still to ask about after this one."""
        return self.cards.get(cid, {}).get("then", [])

    async def confirm(self, cid: str, ok: bool, never: set[str] | None = None) -> list[dict] | None:
        """The grant card's answer. Allow: for each task a worktree, a record, and a session with the grant that gets the
        task as its first request; past the limit the record waits as Queued."""
        c = self.cards.pop(cid, None)
        if c is None:
            raise DelegationError("That card is gone. Tap Delegate again.")
        if not ok:
            return None
        made: list[dict] = []
        for task, branch in zip(c["tasks"], c["branches"]):
            wt = await asyncio.to_thread(worktree.create, c["repo"], branch, None, never)
            key = self.store.new_session(wt.path)
            r = {"id": uuid.uuid4().hex, "task": task["id"], "title": task["title"], "url": task.get("url"),
                 "repo": wt.repo, "label": c["label"], "branch": branch, "worktree": wt.path, "base": wt.base,
                 "session": key, "stage": "new", "created": time.time(), "started": False}  # _go: working or queued
            self.items[r["id"]] = r
            await self._go(r, brief(task, branch, self.store.commands(c["repo"])["test"]))
            made.append(r)
        await self.changed()
        return made

    async def _go(self, r: dict, text: str, interrupt: bool = False) -> None:
        """Start its next request now when a slot is free, else queue it (the request is kept for when it starts)."""
        if self._free() > 0 and not self._queued():
            r["stage"] = "working"
            await self._start(r, text, interrupt)
        else:
            r.update(stage="queued", queued=time.time(), next={"text": text, "interrupt": interrupt})

    async def _fill(self) -> None:
        """A slot freed: start the oldest queued ones while slots are free."""
        started = False
        while self._free() > 0 and (q := self._queued()):
            r = q[0]
            nxt = r.pop("next", None) or {"text": "", "interrupt": False}
            r["stage"] = "working"
            r.pop("queued", None)
            await self._start(r, nxt["text"], nxt["interrupt"])
            started = True
        if started:
            await self.changed()

    async def _start(self, r: dict, text: str, interrupt: bool = False) -> None:
        """Send the session its next request, under the grant (re-attached to a session reopened after a restart,
        unless the owner revoked it)."""
        s = self.session(r["worktree"], r["session"])
        if s.grant is None and not r.get("revoked"):
            cmds = self.store.commands(r["repo"])
            await s.attach_grant(grant.for_repo(s.fence, r["worktree"], r["branch"], False, [v for v in cmds.values() if v]))
        if interrupt and s.busy:
            self.skip.add(r["id"])  # the stopped turn's result isn't the end of the work: no check for it
            await s.interrupt()
        self.seen[r["id"]] = time.time()
        r["started"] = True
        self._spawn(s.send(text, "text"))

    def revoked(self, key: str) -> None:
        """The owner revoked this session's grant: Retry and Resume don't bring it back."""
        if r := self.of_session(key):
            r["revoked"] = True
            self._save()

    def _spawn(self, coro: Awaitable[Any]) -> None:
        job = asyncio.ensure_future(coro)
        self.jobs.add(job)
        job.add_done_callback(self.jobs.discard)

    # -- the session's progress ---------------------------------------------------------------

    async def on_event(self, key: str, ev: dict) -> None:
        """An event of a delegation's session: a turn that ended starts the check; a card changes the line."""
        r = self.of_session(key)
        if r is None:
            return
        self.seen[r["id"]] = time.time()
        if r["id"] in self.stuck and ev["type"] not in ("result", "permission", "permission_done"):
            await self.tick()  # it moved again (those three push below anyway)
        if ev["type"] == "result" and r["id"] in self.skip:
            self.skip.discard(r["id"])
        elif ev["type"] == "result" and not ev.get("replay") and r["stage"] in ("working", "ready", "failed", "stopped"):
            r["stage"] = "testing"
            for k in ("conflict", "outward", "outward_problem"):
                r.pop(k, None)
            await self.changed()
            self._spawn(self.check(r))
        elif ev["type"] in ("permission", "permission_done") and r["stage"] == "working":
            await self.push(self.event())

    async def tick(self) -> None:
        """Every minute (and when a stuck one moves): tell the pages when a delegation became stuck or moved again."""
        now = {r["id"] for r in self.items.values() if self._stuck(r)}
        if now != self.stuck:
            self.stuck = now
            await self.push(self.event())
            await self._fill()  # a stuck one gave up its slot

    # -- Retry, Resume ------------------------------------------------------------------------

    async def retry(self, rid: str) -> dict:
        """A failed or stuck delegation: the same session gets what went wrong as its next request."""
        r = self._get(rid)
        b = r["branch"]
        if r["stage"] == "failed":
            text = (f"Orb checked your work on {b} after your last turn: {r.get('problem') or 'it failed'}. "
                    f"Fix that, run the tests again, and commit on {b}.")
        elif self._stuck(r):
            text = (f"Nothing happened in this session for {STUCK // 60} minutes, so I stopped the last step. Check "
                    f"where you are, finish the task, run the tests and commit on {b}.")
        else:
            raise DelegationError("Only a delegation whose tests failed or that is stuck can be retried.")
        stuck = r["stage"] == "working"
        r["stage"] = "retrying"  # holds no slot while it takes its place
        r.pop("problem", None)
        await self._go(r, text, interrupt=stuck)
        self.stuck.discard(rid)
        await self.changed()
        return r

    async def resume(self, rid: str) -> dict:
        """Stopped by restart: the same session, worktree and grant carry on; nothing else ever resumes it."""
        r = self._get(rid)
        if r["stage"] != "stopped":
            raise DelegationError("Only a delegation stopped by a restart can be resumed.")
        first = r.pop("next", None)  # queued when the server stopped: it never started, so its first request
        r.pop("queued", None)
        r["stage"] = "resuming"  # holds no slot while it takes its place
        await self._go(r, first["text"] if first else f"Orb restarted while you were working on this task. Carry on "
                       f"where you stopped: finish the task, run the tests and commit on {r['branch']}.")
        await self.changed()
        return r

    async def check(self, r: dict) -> None:
        """After a turn: committed work, a clean worktree and the declared tests passing make it Ready."""
        try:
            wt = self._wt(r)
            if await asyncio.to_thread(worktree.ahead, wt) == 0:
                r.update(stage="failed", problem=f"No commits on branch {r['branch']}")
            elif await asyncio.to_thread(worktree.dirty, wt):
                r.update(stage="failed", problem=f"Uncommitted changes on branch {r['branch']}")
            elif test := self.store.commands(r["repo"])["test"]:
                passed, first = await run_tests(wt.path, test)
                if passed:
                    r.update(stage="ready", tests="passed")
                    await self._outward(r, wt)
                else:
                    r.update(stage="failed", tests="failed", problem=f"Tests failed: {first}")
            else:
                r.update(stage="ready", tests="none")
        except (DelegationError, worktree.WorktreeError, OSError, ValueError) as e:
            r.update(stage="failed", problem=str(e)[:LINE_MAX])
        await self.changed()
        await self._fill()

    # -- outward steps ------------------------------------------------------------------------

    async def _outward(self, r: dict, wt: worktree.Worktree) -> None:
        """Tests passed: push and open the PR when the repo's setting allows it, else ask; nothing without a remote."""
        try:
            where = await asyncio.to_thread(worktree.remote_of, wt.repo)
            if where is None:
                return
            if await asyncio.to_thread(worktree.from_snapshot, wt):
                r["outward"] = "snapshot"
                return
            r.update(remote=where[0], into=where[1], unpushed=await asyncio.to_thread(worktree.unpushed, wt, *where))
        except worktree.WorktreeError as e:  # e.g. the checkout left its branch: still Ready, not pushed
            r.update(outward="failed", outward_problem=str(e)[:LINE_MAX])
            return
        if self.store.outward(r["repo"]) and not self.session(r["worktree"], r["session"]).fence.in_client():
            await self._publish(r, wt)
        else:
            r["outward"] = "ask"

    async def outward(self, rid: str, allow: bool) -> dict:
        """The outward card's answer: Allow pushes (and opens the PR); Skip leaves it Ready with the branch."""
        r = self._get(rid)
        if self.needs(r) != "outward":
            raise DelegationError("That delegation has nothing waiting to be pushed.")
        if not allow:
            r["outward"] = "skipped"
            await self.changed()
            return r
        await self._publish(r, self._wt(r))
        return r

    async def _publish(self, r: dict, wt: worktree.Worktree) -> None:
        r.update(stage="pushing", outward="pushing")
        r.pop("outward_problem", None)
        await self.changed()
        try:
            await asyncio.to_thread(worktree.push, wt, r["remote"])
            if not r.get("pr"):
                link = f": {r['url']}" if r.get("url") else ""
                body = f"Task #{r['task']}{link}\n\nDelegated with Orb; the repo's tests passed in its worktree."
                r["pr"], r["pr_url"] = await open_pr(wt.repo, r["branch"], r["into"], r["title"], body)
            r["outward"] = "done"
        except (DelegationError, worktree.WorktreeError, OSError) as e:
            r.update(outward="failed", outward_problem=str(e)[:LINE_MAX])
        if r["stage"] == "pushing":  # unless Discard came meanwhile
            r["stage"] = "ready"
        if r["id"] in self.items:
            await self.changed()

    # -- Review, Apply, Undo, Discard ---------------------------------------------------------

    async def diff(self, rid: str, send: Callable[[dict], Awaitable[None]]) -> None:
        r = self._get(rid)
        text = await asyncio.to_thread(worktree.diff, self._wt(r))
        await send({"type": "delegation_diff", "id": rid, "branch": r["branch"], "diff": text})

    async def _stop(self, r: dict) -> None:
        s = self.session(r["worktree"], r["session"])
        await s.revoke_grant()
        await s.close()

    async def apply(self, rid: str, mode: Callable[[str], str]) -> dict:
        """`mode(repo)`: the repo's Apply mode (squash or merge)."""
        r = self._get(rid)
        if r["stage"] != "ready":
            raise DelegationError("Only a Ready delegation can be applied.")
        await self._stop(r)  # nothing writes to the branch while it lands
        wt = self._wt(r)
        try:
            r["commit"] = await asyncio.to_thread(worktree.apply, wt, mode(r["repo"]), f"{r['title']} (task #{r['task']})")
        except worktree.Conflict as e:
            r["conflict"] = str(e)
            await self.changed()
            return r
        r.pop("conflict", None)
        r["target"] = await asyncio.to_thread(worktree.current_branch, wt.repo)
        r["stage"] = "applied"
        r["leftovers"] = await asyncio.to_thread(worktree.remove, wt)
        self.store.forget(r["worktree"])
        await self.changed()
        await self.done(r["task"], True)
        return r

    async def revert(self, rid: str) -> dict:
        r = self._get(rid)
        if r["stage"] != "applied" or not r.get("commit"):
            raise DelegationError("Only an applied delegation can be undone.")
        r["revert"] = await asyncio.to_thread(worktree.revert, r["repo"], r["commit"])
        r["stage"] = "reverted"
        await self.changed()
        await self.done(r["task"], False)
        return r

    async def discard(self, rid: str) -> list[str]:
        """Stop the session, drop the branch and worktree and the record; returns what could not be removed."""
        r = self._get(rid)
        left: list[str] = []
        if r["stage"] not in ("applied", "reverted"):
            if r.get("started", True):  # one that never started has no session to stop
                await self._stop(r)
            wt = worktree.get(r["worktree"])
            left = await asyncio.to_thread(worktree.remove, wt) if wt else []
            self.store.forget(r["worktree"])
        del self.items[rid]
        await self.changed()
        await self._fill()
        return left
