"""Delegations (ADR 0003, 0004, 0005): a Vikunja task handed to a background session in its own worktree.

Delegate raises the grant card (repo, branch, what the session may do without asking); Deny starts nothing. Allow
creates the worktree, a record in `delegations.json` and a session at the worktree that carries the grant, and sends
it the task as its first request. Base from the remote tip (#864): with a remote for the target branch, Orb fetches it
and the branch starts from its tip when the checkout is only behind it, else from HEAD; uncommitted changes stay out
(the card says how many files: "commit them first to include them"). A fetch that fails is not an error: the branch
starts from HEAD and the line says "could not reach <remote>, branched from your local <into>". Without a remote the
branch starts from a snapshot of the checkout, uncommitted changes included. When a turn of that session ends, Orb
runs the repo's declared test command in the worktree itself (what the session says is a claim): Ready when it passes or
none is declared, failed otherwise. Ready offers Review (the diff) and Apply; Apply stops the session, lands the
branch on the checkout's branch (a conflict changes nothing), marks the task done and removes the worktree; Undo
reverts it and reopens the task. Discard stops the session and drops the branch and worktree.
The stage line is the only status word: a delegation is never Finished.

Outward steps (#771, ADR 0004): when the tests passed and the repo has a remote, Orb (not the session) may push the
branch and open a PR with gh. The repo's outward steps setting does it at once (never in a client folder); otherwise
the delegation stays Ready and Needs you asks "Push branch X and open a PR for task #N?" (Allow, Skip, Discard). Skip
and Deny never contact the remote. A branch that starts from Orb's snapshot of uncommitted changes (made only without
a remote) is never pushed.
Allow: "Opening PR", then "Ready: PR #M, tests passed"; a failure stays Ready with the branch and says why. Apply and
Undo stay local (the owner's choice): Apply merges the branch into the checkout and leaves the PR open as history.

Collisions (#863): when the tests passed, before any push, Orb fetches the remote target branch and merges the
checked commit against its tip in memory. Clean but behind stays Ready ("main moved 3 commits, merges cleanly").
A conflict pushes nothing and raises Needs you "collision": the files (CAP, then "and N more") and who landed first
in each (git author, "you" when it is the repo's user.email, when, subject). Apply is refused; Review and Discard
stay; Discard leaves a pushed branch and its PR on the remote. Every collision is kept in the record's `collisions`.
Update from <into> (#869): Orb starts `git merge` of the fresh remote target into the branch (never a rebase, never a
force push) and the same session gets the request to re-apply its change on top of the other side's lines, which stay
exactly as they landed, then commit the merge. After that turn Orb checks the merge commit holds every line they added;
if not (or there is no merge commit) it is refused: "Can't update without changing their lines", Discard only. A kept
update is checked like any turn (Ready only when Orb's own tests pass) and its push asks again ("Push the update to
branch X (PR #N)?") unless outward steps are on.
The PR's states (#877): every POLL Orb reads the open PR with gh (state, mergeability, branch protection, checks,
review). Merged by someone on the remote: the task is done ("Merged by <login> on <remote>"), the session stops, the
record keeps `merge_sha`, and the checkout fast-forwards to it only when it is on the target branch, clean and behind
(else "pull to get it"); no Undo, Discard only cleans up. Closed without merging: Needs you "closed" (Reopen PR runs
`gh pr reopen`, only on that tap; polling resumes after it), Apply refused. Blocked by a failing check: Needs you
"blocked" naming the check (a link to it; Orb never reruns it), Send back gives the session only the check's name and
conclusion, never its log. Blocked by a required review only: still Ready, " · waiting for review on <remote>", Apply
refused with that line. Behind with a clean merge: Needs you "update", and Update from <into> makes the merge commit
itself (no session turn), runs the declared test and asks to push (at once with outward steps); a conflict is the #869
flow. Nothing the remote wrote (names, logs) reaches a session prompt except a check's name in a safe charset.

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
The claim (#866, `claim.py`): the card is refused when Orb can't tell who the owner is in the tracker or a teammate
holds the task ("Task #N is held by <name>"); its branch is per person, orb/<tracker user>/<task>-<slug>. Allow claims
each task before its worktree (one that can't be claimed is skipped with its reason, the others start; nothing is
retried); a worktree that fails takes back the claim it just made. The record keeps `claimed` (Orb added the
assignment), and only Discard takes that back.
Tracker comments (#866 Q6, `Claims.note`): after Allow, "Delegated with Orb on <host>, branch <branch>."; after a new PR,
"PR #N: <link>". In the background: a failure is logged, the strip adds "tracker comment not posted", nothing stops.
The host name goes only in that comment, never in a PR or a commit. Nothing is said on Discard or Apply.
Bulk Delegate: one grant card per repo (the tasks of that repo in a list), shown one after another; Deny skips that
repo's tasks and the next repo's card comes up either way.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import signal
import socket
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from . import claim, config, grant, sandbox, worktree
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
                  "task; my checkout is elsewhere and not yours to touch. Edit files here, "
                  f"{tests}then commit your work on {branch} with git add and git commit. Don't push, open a "
                  "pull request, merge or switch branches: I review and apply it myself. End with a few lines on what "
                  "you changed and anything I should check.")


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def ago(t: float, now: float | None = None) -> str:
    s = max(0, int((now or time.time()) - t))
    return "just now" if s < 60 else f"{s // 60} min ago" if s < 3600 else f"{s // 3600} h ago" if s < 86400 else f"{s // 86400} d ago"


def collision_text(c: dict, into: str) -> str:
    """The collision card: "Conflict with main in f.py. Landed first: f.py by Alice Acme 2 h ago ('fix rounding')."."""
    files = c["files"]
    named = ", ".join(files[:worktree.CAP]) + (f" and {len(files) - worktree.CAP} more" if len(files) > worktree.CAP else "")
    first = ", ".join(f"{x['file']} by {'you' if x['mine'] else x['author']} {ago(x['when'])} ('{x['subject'][:60]}')"
                      for x in c["landed"])
    return f"Conflict with {into} in {named}." + (f" Landed first: {first}." if first else "")


def first_text(landed: list[dict]) -> str:
    """Who landed first, for the merge commit and the Ready line: "f.py changed first by Alice Acme"."""
    return ", ".join(f"{x['file']} changed first by {'you' if x['mine'] else x['author']}" for x in landed)


def covers(branch: str, commands: dict[str, str], outward: bool = False) -> list[str]:
    """What the grant lets the session do without asking, in the card's words."""
    out = ["Edit files in its own worktree"]
    if any(commands.values()) and not sandbox.available():
        out.append("No sandbox on this machine: running the test or build command asks first")
    else:
        out += [f"Run the {k} command in a sandbox (worktree only, no home folder): {c}" for k, c in commands.items() if c]
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


POLL = 600  # an open PR's mergeable state is read at most this often (#870)


async def _gh(repo: str, *args: str) -> tuple[int, str]:
    """One gh call in `repo` (no prompts): (exit code, its output)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "gh", *args, cwd=repo, env={**os.environ, "GH_PROMPT_DISABLED": "1"}, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
    except FileNotFoundError:
        raise DelegationError("gh is not installed") from None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), PR_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise DelegationError(f"gh {' '.join(args[:2])} timed out") from None
    return proc.returncode or 0, out.decode(errors="replace")


PR_FIELDS = "state,mergeable,mergeStateStatus,mergedBy,mergeCommit,reviewDecision,statusCheckRollup"
_BAD = ("FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR")
_LOGIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?")


def login(x: Any) -> str:
    """A GitHub login as the remote gave it, or "" when it isn't one (nothing else is shown)."""
    x = x.get("login") if isinstance(x, dict) else x
    return x if isinstance(x, str) and _LOGIN.fullmatch(x) else ""


def check_name(x: Any) -> str:
    """A check's name in a safe charset, capped: the only remote-authored words a session prompt may carry."""
    return re.sub(r"[^A-Za-z0-9 _.:/()-]", "", x if isinstance(x, str) else "").strip()[:60] or "a check"


def read_pr(seen: dict) -> dict:
    """`gh pr view --json PR_FIELDS` in Orb's words: state, mergeable, merge_state (mergeStateStatus), merged_by,
    merge_sha, review (reviewDecision), failing checks [{name, conclusion, url}] and whether any is still pending."""
    failing, pending = [], False
    for c in seen.get("statusCheckRollup") or []:
        if not isinstance(c, dict):
            continue
        said = str(c.get("conclusion") or c.get("state") or "").upper()  # a CheckRun's conclusion, a StatusContext's state
        if said in _BAD:
            url = c.get("detailsUrl") or c.get("targetUrl") or ""
            failing.append({"name": check_name(c.get("name") or c.get("context")), "conclusion": said,
                            "url": url if isinstance(url, str) and re.fullmatch(r"https://\S{1,500}", url) else None})
        elif not said or said in ("PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS") or c.get("status") not in (None, "COMPLETED"):
            pending = True
    sha = (seen.get("mergeCommit") or {}).get("oid") if isinstance(seen.get("mergeCommit"), dict) else None
    return {"state": str(seen.get("state") or ""), "mergeable": str(seen.get("mergeable") or "UNKNOWN"),
            "merge_state": str(seen.get("mergeStateStatus") or "UNKNOWN"), "merged_by": login(seen.get("mergedBy")),
            "merge_sha": sha if isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40,64}", sha) else None,
            "review": str(seen.get("reviewDecision") or ""), "failing": failing[:worktree.CAP], "pending": pending}


async def pr_state(repo: str, number: int) -> dict:
    """`gh pr view <n>`, read by `read_pr`; mergeable is "UNKNOWN" while GitHub is still computing it."""
    code, text = await _gh(repo, "pr", "view", str(number), "--json", PR_FIELDS)
    try:
        seen = json.loads(text) if code == 0 else None
    except ValueError:
        seen = None
    if not isinstance(seen, dict):
        raise DelegationError(f"gh pr view failed: {failing_line(text)}")
    return read_pr(seen)


async def closed_by(repo: str, number: int) -> str:
    """Who closed the PR (gh pr view doesn't say); "" when gh can't tell."""
    try:
        code, text = await _gh(repo, "api", f"repos/{{owner}}/{{repo}}/issues/{number}", "--jq", ".closed_by.login")
    except DelegationError:
        return ""
    return login(text.strip()) if code == 0 else ""


async def reopen_pr(repo: str, number: int) -> None:
    code, text = await _gh(repo, "pr", "reopen", str(number))
    if code != 0:
        raise DelegationError(f"gh pr reopen failed: {failing_line(text)}")


async def run_tests(path: str, cmd: str, timeout: float = TEST_TIMEOUT) -> tuple[bool, str]:
    """The repo's declared test command in the worktree, in the sandbox: it runs files the session edited.
    (passed, first failing line); a timeout kills the whole process group."""
    proc = await asyncio.create_subprocess_shell(sandbox.wrap(path, cmd), cwd=path, stdout=asyncio.subprocess.PIPE,
                                                 stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL,
                                                 start_new_session=True)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()
        return False, f"timed out after {int(timeout // 60)} min"
    text = out[-OUTPUT_MAX:].decode(errors="replace")
    return proc.returncode == 0, "" if proc.returncode == 0 else failing_line(text)


class Delegator:
    """The delegation records and their lifecycle. `session(path, key)` opens (or returns) a FolderSession,
    `push(ev)` sends to every page, `done(task, on)` writes the task done (or open) in Vikunja and the plan,
    `waiting(key)` is the words of the card that session waits on ("" when none), `limit()` how many may hold a slot,
    `claims` the tracker side (None: no claim and the old branch names, for tests that don't need a tracker), `never()`
    the never-open names (the card counts uncommitted files the way a snapshot would)."""

    def __init__(self, path: Path, *, store: Any, session: Callable[[str, str], Any],
                 push: Callable[[dict], Awaitable[None]], done: Callable[[int, bool], Awaitable[None]],
                 waiting: Callable[[str], str] = lambda key: "", limit: Callable[[], int] = lambda: LIMIT,
                 claims: claim.Claims | None = None, never: Callable[[], set[str]] = lambda: set()) -> None:
        self.path, self.store, self.session, self.push, self.done, self.waiting = path, store, session, push, done, waiting
        self.limit, self.claims, self.never = limit, claims, never
        self.cards: dict[str, dict] = {}  # open grant cards, by id
        self.jobs: set[asyncio.Task] = set()
        self.seen: dict[str, float] = {}  # the last event of each running delegation's session (this run only)
        self.stuck: set[str] = set()  # the ones the pages were last told are stuck
        self.skip: set[str] = set()  # Retry interrupted their turn: its result starts no check
        self.polling: set[str] = set()  # the ones whose PR is being read right now
        raw = config.read_state(path) or {}
        self.items: dict[str, dict] = raw.get("delegations", {})
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
        config.write_private(self.path, json.dumps({"version": 1, "delegations": self.items}, indent=2))

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
        for an OK), "collision", and the PR's "closed", "blocked" (a failing check), "update" (behind, merges cleanly);
        None while it can."""
        if r["stage"] in ("failed", "stopped"):
            return r["stage"]
        if r["stage"] == "ready" and r.get("collision"):
            return "collision"
        if r["stage"] == "ready" and "closed_by" in r:
            return "closed"
        if r["stage"] == "ready" and r.get("blocked"):
            return "blocked"
        if r["stage"] == "ready" and r.get("clean_update"):
            return "update"
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
        start = f" · {r['unreached']}" if r.get("unreached") and r["stage"] not in ("applied", "reverted") else ""
        return self._line(r) + start + (" · tracker comment not posted" if r.get("uncommented") else "")

    def _line(self, r: dict) -> str:
        s, b = r["stage"], r["branch"]
        if s == "queued":
            return f"Queued · {ordinal(self._queued().index(r) + 1)}"
        if s == "working":
            if self.waiting(r["session"]):
                return "Waiting for your OK"
            if self._stuck(r):
                return f"Stuck {STUCK // 60} min"
            return f"Updating from {r.get('into')}" if r.get("updating") else "Working"
        if s == "testing":
            return "Running tests"
        if s == "pushing":
            return f"Pushing to PR #{r['pr']}" if r.get("pr") else "Opening PR"
        if s == "ready" and "taken" in r.get("collision", {}):
            return (f"Branch {b} already exists on {r['collision']['taken']} with someone else's commits; someone else "
                    "may have delegated this task.")
        if s == "ready" and "refused" in r.get("collision", {}):
            named = ", ".join(r["collision"]["refused"])
            return "Can't update without changing their lines" + (f" in {named}." if named else ".")
        if s == "ready" and r.get("collision"):
            return collision_text(r["collision"], r.get("into") or "main")
        if s == "ready" and "closed_by" in r:
            by = f" by {r['closed_by']}" if r["closed_by"] else ""
            return f"PR #{r['pr']} was closed on {r.get('remote')}{by}."
        if s == "ready" and r.get("blocked"):
            named = ", ".join(f"{c['name']} ({c['conclusion'].lower()})" for c in r["blocked"])
            return f"PR #{r['pr']} is blocked on {r.get('remote')}: a required check failed: {named}."
        if s == "ready":
            head = f"Ready: PR #{r['pr']}, " if r.get("pr") else f"Ready: branch {b}, "
            tail = {"failed": f" · not pushed: {r.get('outward_problem')}",
                    "snapshot": " · not pushed: it starts from your uncommitted changes"}.get(r.get("outward") or "", "")
            said = {"passed": "tests passed", "skipped": "tests not run (no sandbox here)"}.get(r.get("tests"), "no tests declared")
            if n := r.get("behind"):
                tail = f" · {r.get('into')} moved {n} commit{'s' * (n != 1)}, merges cleanly" + tail
            if (first := r.get("updated")) is not None:
                head = f"Ready: updated from {r.get('into')}" + (f" ({first}), " if first else ", ")
            if r.get("waiting"):
                tail += f" · {self._waiting(r)}"
            return head + said + tail
        if s == "failed":
            return r.get("problem") or "Tests failed"
        if s == "applied":
            left = f" Left behind: {', '.join(r['leftovers'])}." if r.get("leftovers") else ""
            pr = f" PR #{r['pr']} stays open." if r.get("pr") else ""
            return f"Applied to {r.get('target')}; task #{r['task']} done.{pr}{left}"
        if s == "reverted":
            return f"Reverted; task #{r['task']} reopened."
        if s == "merged":
            by = f" by {r['merged_by']}" if r.get("merged_by") else ""
            got = f" Your {r.get('into')} has it." if r.get("fast_forwarded") else f" Pull {r.get('into')} to get it."
            return f"Merged{by} on {r.get('remote')}; task #{r['task']} done.{got}"
        return "Stopped by restart"

    @staticmethod
    def _waiting(r: dict) -> str:
        """What a blocked PR waits for that isn't the owner's to fix here."""
        where = r.get("remote")
        return {"review": f"waiting for review on {where}", "changes": f"changes requested on {where}",
                "checks": f"waiting for checks on {where}"}.get(r.get("waiting") or "", f"blocked by branch rules on {where}")

    def event(self) -> dict:
        rows = sorted(self.items.values(), key=lambda r: r["created"])  # an order that stays put
        return {"type": "delegations", "items": [
            {"id": r["id"], "task": r["task"], "title": r["title"], "repo": r["label"], "branch": r["branch"],
             "stage": r["stage"], "line": self.line(r), "session": r["session"], "folder": r["worktree"],
             "conflict": r.get("conflict"), "apply_text": self.apply_text(r), "needs": self.needs(r), "ask": self.ask(r),
             "pr": r.get("pr"), "pr_url": r.get("pr_url"), "update_from": self.update_from(r),
             "checks": r.get("blocked") or None}
            for r in rows]}

    def update_from(self, r: dict) -> str | None:
        """The target branch Update can merge in: Ready with a collision that wasn't refused (a taken branch has
        nothing to merge: Discard only), or a PR behind it that merges cleanly (#877)."""
        c = r.get("collision")
        if r["stage"] == "ready" and r.get("clean_update"):
            return r.get("into")
        return r.get("into") if r["stage"] == "ready" and c and not {"refused", "taken"} & c.keys() else None

    def apply_text(self, r: dict) -> str:
        what = f"PR #{r['pr']}" if r.get("pr") else f"branch {r['branch']}"
        return f"Apply merges {what} and marks task #{r['task']} done."

    def ask(self, r: dict) -> str | None:
        """What it waits for the owner to allow: the card its session waits on, or the outward steps."""
        if r["stage"] == "working":
            return self.waiting(r["session"]) or None
        if self.needs(r) == "closed":
            return f"Reopen PR #{r['pr']} on {r.get('remote')}?"
        if self.needs(r) == "update":
            return f"Update branch {r['branch']} from {r.get('into')}? It merges cleanly: Orb commits the merge and runs the tests."
        if self.needs(r) != "outward":
            return None
        if r.get("pr") and r.get("updated") is not None:
            return f"Push the update to branch {r['branch']} (PR #{r['pr']})?"
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
        return any(r["task"] == task_id and r["stage"] not in ("applied", "reverted", "merged") for r in self.items.values())

    def card(self, task: dict, repo: str, label: str) -> dict:
        """The grant card for `task` in `repo` (an allowed folder); nothing starts until it is allowed. Runs git."""
        if self._delegated(task["id"]):
            raise DelegationError(f"Task #{task['id']} is already delegated.")
        return self._card([task], repo, label, [], self._who(task))

    def _who(self, task: dict) -> str:
        """The owner's tracker username for the branch, after checking no teammate holds the task ("" without claims)."""
        if self.claims is None:
            return ""
        try:
            return self.claims.check(task)["username"]
        except claim.ClaimError as e:
            raise DelegationError(str(e)) from e

    def _card(self, tasks: list[dict], repo: str, label: str, then: list[tuple[list[dict], str, str]], who: str) -> dict:
        top = worktree.toplevel(repo)
        worktree.current_branch(top)  # a repo on a branch, or no card
        rows = [{"task": t["id"], "title": t["title"], "branch": worktree.branch_name(t["id"], t["title"], who)} for t in tasks]
        cid = uuid.uuid4().hex
        self.cards[cid] = {"tasks": tasks, "repo": repo, "label": label, "branches": [x["branch"] for x in rows], "then": then}
        one = rows[0]
        said = covers(one["branch"] if len(rows) == 1 else "each task's own branch", self.store.commands(repo),
                      self.store.outward(repo) and not Fence(repo).in_client())
        if worktree.remote_of(top) is not None and (n := worktree.uncommitted(top, self.never())):
            said.append(f"Your uncommitted changes ({n} file{'s' * (n != 1)}) stay out; commit them first to include them.")
        return {"type": "delegate_card", "id": cid, "task": one["task"], "title": one["title"], "repo": label,
                "branch": one["branch"], "rows": rows, "more": len(then), "covers": said}

    def bulk(self, groups: list[tuple[list[dict], str, str]]) -> tuple[dict | None, list[str]]:
        """Bulk Delegate: `groups` is (tasks, repo, label) per repo, in order. The first repo's card that can be made
        (its other cards follow its answer, see `then`), and what was skipped on the way."""
        skipped: list[str] = []
        while groups:
            (tasks, repo, label), groups = groups[0], groups[1:]
            fresh, who = [], ""
            for t in tasks:
                try:
                    if self._delegated(t["id"]):
                        raise DelegationError(f"Task #{t['id']} is already delegated.")
                    who = self._who(t)
                    fresh.append(t)
                except DelegationError as e:
                    skipped.append(str(e))
            if not fresh:
                continue
            try:
                return self._card(fresh, repo, label, groups, who), skipped
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
        skipped: list[str] = []
        for task, branch in zip(c["tasks"], c["branches"]):
            claimed = False
            if self.claims is not None:
                try:
                    claimed = await asyncio.to_thread(self.claims.claim, task["id"])
                except claim.ClaimError as e:
                    skipped.append(str(e))
                    continue
            try:
                where = await asyncio.to_thread(worktree.remote_of, c["repo"])
                wt = await asyncio.to_thread(worktree.create, c["repo"], branch, None, never, where)
            except Exception:
                if claimed:
                    await self._release(task["id"])
                raise
            key = self.store.new_session(wt.path)
            r = {"id": uuid.uuid4().hex, "task": task["id"], "title": task["title"], "url": task.get("url"),
                 "repo": wt.repo, "label": c["label"], "branch": branch, "worktree": wt.path, "base": wt.base,
                 "session": key, "stage": "new", "created": time.time(), "started": False,  # _go: working or queued
                 "claimed": claimed}
            if wt.unreached and where:  # the fetch failed: it starts from HEAD, and the line says so
                r["unreached"] = f"could not reach {wt.unreached}, branched from your local {where[1]}"
            self.items[r["id"]] = r
            await self._go(r, brief(task, branch, self.store.commands(c["repo"])["test"]))
            self._note(r, f"Delegated with Orb on {socket.gethostname()}, branch {branch}.")
            made.append(r)
        if skipped and not made:
            raise DelegationError(" ".join(skipped))
        await self.changed()
        if skipped:
            await self.push({"type": "notice", "level": "warn", "text": " ".join(skipped)})
        return made

    def _note(self, r: dict, text: str) -> None:
        """Tell the teammates in the tracker, in the background (#866 Q6): a failure is logged and the strip says so,
        the delegation goes on. The host name goes only here, never in a PR or a commit."""
        if self.claims is None:
            return

        async def post() -> None:
            try:
                await asyncio.to_thread(self.claims.note, r["task"], text)
            except claim.ClaimError as e:
                log.warning("%s", e)
                r["uncommented"] = True
                if r["id"] in self.items:
                    await self.changed()

        self._spawn(post())

    async def _release(self, task_id: int) -> str | None:
        """Take back the claim this server made; what went wrong, else None."""
        try:
            await asyncio.to_thread(self.claims.release, task_id)
        except claim.ClaimError as e:
            log.warning("%s", e)
            return str(e)
        return None

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
            for k in ("conflict", "outward", "outward_problem", "collision", "behind", "updated", "blocked", "waiting",
                      "clean_update"):
                r.pop(k, None)
            await self.changed()
            self._spawn(self.check(r))
        elif ev["type"] in ("permission", "permission_done") and r["stage"] == "working":
            await self.push(self.event())

    async def tick(self) -> None:
        """Every minute (and when a stuck one moves): tell the pages when a delegation became stuck or moved again,
        and read an open PR's state when its turn comes."""
        now = {r["id"] for r in self.items.values() if self._stuck(r)}
        if now != self.stuck:
            self.stuck = now
            await self.push(self.event())
            await self._fill()  # a stuck one gave up its slot
        for r in list(self.items.values()):
            if (r["stage"] == "ready" and r.get("pr") and r.get("outward") == "done" and not r.get("collision")
                    and not r.get("pr_closed") and not r.get("clean_update") and r["id"] not in self.polling
                    and time.time() - r.get("polled", 0) >= POLL):
                r["polled"] = time.time()
                self.polling.add(r["id"])
                self._spawn(self._poll(r))

    async def _poll(self, r: dict) -> None:
        """One read of the PR (#870, #877). Merged or closed: never read again. CONFLICTING, or BEHIND under branch
        protection: the same fetch + merge-tree as at Ready; a conflict raises the collision, a clean BEHIND the
        Update card. BLOCKED: a failing check is Needs you, a review (or a pending check) only a word on the line.
        UNKNOWN is "not yet". A failed read waits for the next turn."""
        rid, pr, checked = r["id"], r["pr"], r.get("checked") or ""
        moved = lambda: self.items.get(rid) is not r or r["stage"] != "ready" or r.get("pr") != pr or r.get("collision")
        try:
            wt = self._wt(r)
            await asyncio.to_thread(worktree.same_config, wt)  # gh runs git here and resolves the repo from its remotes
            seen = await pr_state(wt.repo, pr)
            if moved():
                return  # it moved on while gh answered
            if seen["state"] == "MERGED":
                await self._merged(r, wt, seen)
                return
            if seen["state"] and seen["state"] != "OPEN":
                by = await closed_by(wt.repo, pr)
                if not moved():
                    r.update(pr_closed=True, closed_by=by)
                    await self.changed()
                return
            before = (r.get("blocked"), r.get("waiting"))
            r.pop("blocked", None)
            r.pop("waiting", None)
            if seen["merge_state"] == "BLOCKED":
                if seen["failing"]:
                    r["blocked"] = seen["failing"]
                else:
                    r["waiting"] = {"REVIEW_REQUIRED": "review", "CHANGES_REQUESTED": "changes"}.get(
                        seen["review"], "checks" if seen["pending"] else "rules")
            if seen["mergeable"] == "CONFLICTING" or seen["merge_state"] == "BEHIND":
                got = await asyncio.to_thread(worktree.collide, wt, r["remote"], r["into"], checked)
                if moved() or r.get("checked") != checked:
                    return
                r["behind"] = got["behind"]
                if got["files"]:
                    self._collided(r, got)
                elif seen["merge_state"] == "BEHIND" and got["behind"]:
                    r["clean_update"] = True
                await self.changed()
            elif before != (r.get("blocked"), r.get("waiting")):
                await self.changed()
        except (DelegationError, worktree.WorktreeError, OSError, ValueError) as e:
            log.info("PR #%s of %s: %s", pr, r["branch"], e)
        finally:
            self.polling.discard(rid)

    async def _merged(self, r: dict, wt: worktree.Worktree, seen: dict) -> None:
        """Merged on the remote by someone: the task is done, the session stops; the checkout fast-forwards to the
        merge commit when it can do so safely. Nothing to Undo (it isn't Orb's merge); Discard cleans up."""
        sha = seen["merge_sha"]
        here = False
        if sha:
            try:
                here = await asyncio.to_thread(worktree.fast_forward, wt, r["remote"], r["into"], sha)
            except worktree.WorktreeError as e:
                log.info("PR #%s merged, no fast-forward: %s", r["pr"], e)
        await self._stop(r)
        r.update(stage="merged", pr_closed=True, merged_by=seen["merged_by"], merge_sha=sha, fast_forwarded=here)
        r.pop("ready_at", None)
        await self.changed()
        await self.done(r["task"], True)

    async def reopen(self, rid: str) -> dict:
        """Reopen PR (the owner's tap is the ask; never on its own, whatever the outward steps say): `gh pr reopen`,
        then polling resumes."""
        r = self._get(rid)
        if self.needs(r) != "closed":
            raise DelegationError("Only a delegation whose PR was closed can reopen it.")
        wt = self._wt(r)
        await asyncio.to_thread(worktree.same_config, wt)
        await reopen_pr(wt.repo, r["pr"])
        r.pop("closed_by", None)
        r.pop("pr_closed", None)
        r["polled"] = time.time()
        await self.changed()
        return r

    # -- Retry, Resume ------------------------------------------------------------------------

    async def retry(self, rid: str) -> dict:
        """A failed or stuck delegation, or one whose PR a failing check blocks (Send back): the same session gets
        what went wrong as its next request."""
        r = self._get(rid)
        b = r["branch"]
        if r["stage"] == "failed":
            text = (f"Orb checked your work on {b} after your last turn: {r.get('problem') or 'it failed'}. "
                    f"Fix that, run the tests again, and commit on {b}.")
        elif self.needs(r) == "blocked":
            # the check's name and conclusion only: its log and anything else the remote wrote stay out
            named = ", ".join(f"`{c['name']}` ({c['conclusion'].lower()})" for c in r["blocked"])
            text = (f"A required check on PR #{r['pr']} failed: {named}. Orb doesn't pass on its log. Find the cause in "
                    f"this worktree, fix it, run the tests and commit on {b}.")
        elif self._stuck(r):
            text = (f"Nothing happened in this session for {STUCK // 60} minutes, so I stopped the last step. Check "
                    f"where you are, finish the task, run the tests and commit on {b}.")
        else:
            raise DelegationError("Only a delegation whose tests failed, that is stuck or whose PR check failed can be retried.")
        stuck = r["stage"] == "working"
        r.pop("blocked", None)
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

    async def update(self, rid: str) -> dict:
        """Update from <into>: merge the fresh remote target into the branch, uncommitted, and send the same session
        the request to keep their lines as they landed, re-apply its own change on top and commit the merge."""
        r = self._get(rid)
        if self.update_from(r) is None:
            raise DelegationError("Only a Ready delegation that collided or is behind can be updated.")
        if r.get("clean_update"):
            return await self._update_clean(r)
        c, into, b, remote = r["collision"], r["into"], r["branch"], r["remote"]
        first = first_text(c["landed"])
        msg = f"Merge {remote}/{into} into {b}\n\nConflicts in {', '.join(c['files'])}" + (f"; {first}." if first else ".")
        start = await asyncio.to_thread(worktree.merge_in, self._wt(r), remote, into, msg)
        r["updating"] = {**start, "collision": c, "first": first}
        r["stage"] = "updating"  # holds no slot while it takes its place
        await self._go(r, (
            # no file names, authors or subjects from the remote here: they are someone else's text; git status has the files
            f"{into} on {remote} changed the same files first. Orb started `git merge` of {remote}/{into} into {b} in "
            "this worktree (`git status` lists the conflicted files); it is not committed. Their "
            "lines stay exactly as they landed: don't edit, drop or move any of them. Re-apply your own change on top "
            "of theirs, resolve the conflict markers that way, run the tests, then finish with git add and `git commit "
            "--no-edit`. Don't rebase, reset, abort the merge or push. If your change can't sit next to their lines "
            "without changing them, make no commit and say why."))
        await self.changed()
        return r

    async def _update_clean(self, r: dict) -> dict:
        """Behind, no conflict (#877): Orb makes the merge commit itself, no session turn, then checks it like any turn
        (the declared test; its push asks unless outward steps are on). A conflict meanwhile is the collision."""
        wt, into, remote = self._wt(r), r["into"], r["remote"]
        r.pop("clean_update", None)
        seen = await asyncio.to_thread(worktree.collide, wt, remote, into, r.get("checked") or "")
        r["behind"] = seen["behind"]
        if seen["files"]:
            self._collided(r, seen)
            await self.changed()
            return r
        await asyncio.to_thread(worktree.merge_clean, wt, remote, into, f"Merge {remote}/{into} into {r['branch']}")
        for k in ("conflict", "outward", "outward_problem", "behind", "blocked", "waiting"):
            r.pop(k, None)
        r.update(stage="testing", updated="")
        await self.changed()
        self._spawn(self.check(r))
        return r

    async def _kept(self, r: dict, wt: worktree.Worktree) -> bool:
        """After an update's turn: True when the merge commit kept every line they added; else refused, and the
        collision comes back with Discard only."""
        u = r.pop("updating")
        gone = await asyncio.to_thread(worktree.kept, wt, u)
        r["collisions"][-1]["outcome"] = "refused" if gone is not None else "updated"
        if gone is None:
            r["updated"] = u["first"]
            return True
        r.update(stage="ready", collision={**u["collision"], "refused": gone})
        return False

    async def check(self, r: dict) -> None:
        """After a turn: committed work, a clean worktree and the declared tests passing make it Ready."""
        r.pop("checked", None)  # the commit Ready stands for: push and Apply take only that one
        try:
            wt = self._wt(r)
            if r.get("updating") and not await self._kept(r, wt):
                await self.changed()
                await self._fill()
                return
            head = await asyncio.to_thread(worktree.tip, wt)
            if await asyncio.to_thread(worktree.ahead, wt) == 0:
                r.update(stage="failed", problem=f"No commits on branch {r['branch']}")
            elif await asyncio.to_thread(worktree.dirty, wt):
                r.update(stage="failed", problem=f"Uncommitted changes on branch {r['branch']}")
            elif (test := self.store.commands(r["repo"])["test"]) and not sandbox.available():
                r.update(stage="ready", tests="skipped", checked=head)  # no sandbox: Orb doesn't run the session's code
            elif test:
                passed, first = await run_tests(wt.path, test)
                if await asyncio.to_thread(worktree.tip, wt) != head:
                    r.update(stage="failed", problem=f"Branch {r['branch']} changed while the tests ran; retry to check it again")
                elif passed:
                    r.update(stage="ready", tests="passed", checked=head)
                    await self._outward(r, wt)
                else:
                    r.update(stage="failed", tests="failed", problem=f"Tests failed: {first}")
            else:
                r.update(stage="ready", tests="none", checked=head)
        except (DelegationError, worktree.WorktreeError, OSError, ValueError) as e:
            r.update(stage="failed", problem=str(e)[:LINE_MAX])
        if r["stage"] == "ready":
            r["ready_at"] = time.time()  # the Away recap counts the ones that became Ready while the owner was away
        else:
            r.pop("ready_at", None)
        await self.changed()
        await self._fill()

    # -- outward steps ------------------------------------------------------------------------

    async def _outward(self, r: dict, wt: worktree.Worktree) -> None:
        """Tests passed: push and open the PR when the repo's setting allows it, else ask; nothing without a remote."""
        try:
            where = await asyncio.to_thread(worktree.remote_of, wt.repo)
            if where is None:
                return
            r.update(remote=where[0], into=where[1])
            seen = await asyncio.to_thread(worktree.collide, wt, *where, r.get("checked") or "")
            r["behind"] = seen["behind"]
            if seen["files"]:  # the other side landed first: nothing goes out, the owner decides
                self._collided(r, seen)
                return
            if await asyncio.to_thread(worktree.from_snapshot, wt):
                r["outward"] = "snapshot"
                return
            r["unpushed"] = await asyncio.to_thread(worktree.unpushed, wt, *where)
        except worktree.WorktreeError as e:  # e.g. the checkout left its branch: still Ready, not pushed
            r.update(outward="failed", outward_problem=str(e)[:LINE_MAX])
            return
        if self.store.outward(r["repo"]) and not self.session(r["worktree"], r["session"]).fence.in_client():
            await self._publish(r, wt)
        else:
            r["outward"] = "ask"

    @staticmethod
    def _collided(r: dict, seen: dict) -> None:
        """Raise the collision card; the record keeps every collision."""
        r["collision"] = {"at": time.time(), "files": seen["files"], "landed": seen["landed"]}
        r.setdefault("collisions", []).append({**r["collision"], "outcome": "open"})

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
            await asyncio.to_thread(worktree.push, wt, r["remote"], r.get("checked") or "")
            r["pushed"] = True
            if not r.get("pr"):
                link = f": {r['url']}" if r.get("url") else ""
                body = f"Task #{r['task']}{link}\n\nDelegated with Orb; the repo's tests passed in its worktree."
                r["pr"], r["pr_url"] = await open_pr(wt.repo, r["branch"], r["into"], r["title"], body)
                self._note(r, f"PR #{r['pr']}: {r['pr_url']}")
            r.update(outward="done", polled=time.time())  # GitHub needs a while: the first read waits a full POLL
        except worktree.Taken as e:
            if r.get("pushed"):  # it was ours before: the session rewrote what it had pushed (never forced)
                r.update(outward="failed", outward_problem=str(e)[:LINE_MAX])
            else:  # never ours: someone else's branch of the same name
                r.pop("outward", None)
                r["collision"] = {"at": time.time(), "files": [], "landed": [], "taken": r["remote"]}
                r.setdefault("collisions", []).append({**r["collision"], "outcome": "taken"})
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
        if r.get("collision"):
            raise DelegationError(self.line(r) + " Discard it." if "taken" in r["collision"] else
                                  f"{r.get('into')} changed the same files first: update from it or discard.")
        if "closed_by" in r:
            raise DelegationError(self.line(r) + " Reopen it or discard.")
        if r.get("blocked"):
            raise DelegationError(self.line(r) + " Send it back or discard.")
        if r.get("waiting"):
            raise DelegationError(f"PR #{r['pr']}: {self._waiting(r)}.")
        await self._stop(r)  # nothing writes to the branch while it lands
        wt = self._wt(r)
        try:
            r["commit"] = await asyncio.to_thread(worktree.apply, wt, mode(r["repo"]), f"{r['title']} (task #{r['task']})",
                                                  r.get("checked") or "")
        except worktree.Moved:  # commits came after the check: check again, Apply once it's Ready
            r["stage"] = "testing"
            await self.changed()
            self._spawn(self.check(r))
            return r
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
            merged = r["stage"] == "merged"  # merged on the remote: the session is stopped and the claim stays (done)
            if r.get("started", True) and not merged:  # one that never started has no session to stop
                await self._stop(r)
            wt = worktree.get(r["worktree"])
            left = await asyncio.to_thread(worktree.remove, wt) if wt else []
            self.store.forget(r["worktree"])
            if not merged and r.get("claimed") and self.claims is not None and (why := await self._release(r["task"])):
                left.append(why)
        del self.items[rid]
        await self.changed()
        await self._fill()
        return left
