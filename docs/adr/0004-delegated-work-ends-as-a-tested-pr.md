# Delegated work ends as a tested pull request

A session started by Delegate does not edit the owner's checkout. It works in its own git worktree and branch,
runs the repo's tests, pushes the branch and opens a pull request, and only then comes back: "Ready: PR #N on
branch X, tests passed." Review shows the summary, the diff, the PR link and the test result; Apply merges the PR
(squash or merge commit, per repo) and is undone by reverting it. We chose this over two cheaper options: editing in
place (delegations collide with each other and with the owner's uncommitted work, and "apply" has nothing left to
do) and propose-only sessions (the work happens in two rounds and the edits still land in the owner's tree).

## Consequences

- Nothing arrives as "ready" unless its tests passed. A failing or stuck delegation lands in Needs you with the
  failing output and Send back, which continues the same session on the same branch.
- Before a delegation starts, Orb snapshots the owner's checkout; the worktree never uses or touches their
  uncommitted work.
- Apply is a real button on the Ready item. A merge conflict raises a card and is never resolved automatically.
- Push, opening the PR and merging are outward steps. They ask first unless the repo's own setting allows them
  (default off); client repos always ask.
- After Apply or Discard the worktree and branch are removed; leftovers show in the Delegated strip.
- Delegate is offered only when the item's repo is known from the existing mapping (the notes' project pages:
  `vikunja_project` + `local`); there is no second mapping. An unmapped task gets a repo picker whose choice holds
  for that delegation only; Orb never edits the notes to save it. Notes and note tasks offer Start only.
- The repo fence must treat a delegation's worktree as part of its repo.

## Amended (#771)

- Orb pushes and opens the PR itself (with gh) after its own test run passes; the session never does. Asked on a
  Needs you card ("Push branch X and open a PR for task #N?": push and open PR, Skip, Discard) unless the repo's
  setting allows it; Skip leaves it Ready with the branch only and nothing contacts the remote.
- Apply still merges locally into the checkout's branch, and Undo is a local revert: the owner chose this over
  merging the PR on GitHub. The PR stays open as history; the Applied line says so.
- A branch that starts from Orb's snapshot of uncommitted changes is never pushed (the snapshot holds the owner's
  own unfinished work); it stays Ready with the branch and says why.

## Amended (#863)

- When the tests pass, before any push, Orb fetches the remote target branch: the one remote read a delegation
  makes besides the push itself. It merges the checked commit against that tip in memory (`git merge-tree`).
- Behind but clean is not a collision: it stays Ready and the line adds "main moved N commits, merges cleanly". A
  real conflict pushes nothing and raises Needs you: the files (five, then "and N more") and, per file, who landed
  first (git author or "you", when, subject). The model never picks between two people's edits.
- A collision offers Update from main (a merge, never a rebase or force push) and Discard; Apply is refused. Discard
  is local: a pushed branch and its PR stay on the remote. The record keeps every collision.

## Amended (#869)

- Update from main is the owner's tap, not the model's: Orb starts the merge itself (`git merge --no-commit`) and the
  session only resolves the conflicted files and commits. It may not rebase, reset, abort or push.
- Their lines stay exactly as they landed. Orb checks every hunk the Other side added is still in the merged branch,
  whole and in order; if one is gone or changed (or nothing was committed) the update is refused ("Can't update without changing their lines in
  …"), nothing is pushed and only Discard is left. The owner settles it by hand.
- A kept update runs the declared test again, then the push asks again (or goes at once with outward steps on). The
  PR updates; Apply stays a local merge.
- Before any fetch, push or merge, Orb checks the repo's git config is unchanged since the delegation started, and
  fetches with `protocol.ext.allow=never`: the session can write `.git/config`, so a filter, merge driver or ssh
  command it adds must not run outside its sandbox.

## Amended (#870)

- While a Ready delegation's PR is open, Orb reads its mergeable state with `gh pr view` at most every 10 minutes
  (the first read 10 minutes after the push), one call per PR on the existing minute tick. `UNKNOWN` is "not yet";
  `CONFLICTING` runs the same fetch and in-memory merge as at Ready and raises the collision card only when that
  finds conflicting files. A merged or closed PR is never read again, and a collision stops the reads until it's settled.
  Each read checks the git config first, like a fetch: gh resolves the repo from its remotes.
- A first push refused because the branch already exists on the remote with other commits is not a push failure:
  it raises "Branch X already exists on <remote> with someone else's commits; someone else may have delegated this
  task." with Discard only (nothing to merge, Apply refused). Discard is local; their branch stays. Once Orb has
  pushed the branch itself, a later refusal reads as a push failure (the session rewrote what it pushed; never forced).

## Amended (#866)

- Delegate claims the task in the tracker first; a task held by a teammate is refused, and Orb never takes it from
  them (#866). Its branch is per person: orb/<tracker user>/<task>-<slug>.

## Amended (#864)

- With a remote for the target branch, a delegation no longer starts from a snapshot of the owner's checkout. On
  Allow, Orb fetches `<remote>/<into>` (the same safety as the other fetches: Orb's git env, `protocol.ext.allow=never`,
  the config fingerprint taken before it). This is a second remote read, at start, besides the one at Ready.
- When the owner's HEAD is an ancestor of the fetched tip (only behind, or equal), the branch starts from that tip, so
  the delegation works on what the team has, and Review and Apply show only its own commits (base..branch). When HEAD
  is ahead or has diverged, the branch starts from HEAD, and the push card still names the owner's commits that go along.
- A failed fetch is not an error: the branch starts from HEAD and the line says "could not reach <remote>, branched
  from your local <into>".
- Uncommitted and untracked changes stay out. The grant card says "Your uncommitted changes (N files) stay out;
  commit them first to include them.", counting what a snapshot would have taken (secrets and never-open names aside),
  and says nothing when there are none.
- Without a remote nothing changes: the branch starts from a snapshot, uncommitted work included, and such a branch
  is never pushed.
- A squash Apply lands only base..branch, so it works on a checkout that is still behind. A merge Apply is refused
  until the checkout has the commit the branch started from ("pull them into <into> first"): its merge commit would
  count the team's commits as merged while their files stay out.

## Amended (#876)

Amends #771: with a PR Orb opened, Apply merges it on the remote; without one, Apply and Undo stay local.

- Apply first reads the PR afresh (`gh pr view`, after the git config check). MERGED, CLOSED or BLOCKED is refused with
  that state and nothing is merged. CONFLICTING runs the collision check and raises the collision card only when it
  finds real files; otherwise Apply is refused ("merges cleanly here; try Apply again in a minute").
- The merge always asks, even with the repo's outward steps on or in a client folder: "Merge PR #N on <remote> into
  <into>?" with Merge, Skip and Discard. Allow runs `gh pr merge <n>` with `--squash` or `--merge` (the repo's apply
  mode) and `--match-head-commit <checked commit>`, so GitHub merges only what Orb tested. It never deletes the branch.
- A refusal from GitHub changes nothing locally. A conflict goes to the collision card; any other refusal stays on the
  merge card with GitHub's reason, trimmed (" · not merged: …").
- On success Orb records the merge commit, marks the task done and removes the worktree and branch. It fast-forwards
  the owner's checkout only when it is on the target branch, clean and strictly behind; otherwise the line says
  "merged on <remote>; pull to get it".
- Undo after a merge on the remote reverts that commit (`-m 1` for a merge commit) on a new branch
  `orb/<me>/revert-<task>`, built from the fetched tip without touching the checkout, pushes it and opens a "Revert #N"
  PR against the target: behind the outward card, or at once with outward steps on outside a client folder. The task
  reopens once the PR is open. Undo is offered once; nothing is ever forced.

## Amended (#877)

- The PR read also takes its merge state, merger, merge commit, review decision and checks. Orb shows only words of
  its own: a login, a check's name in a safe charset (60 characters), its conclusion and an https link. A check's log,
  output or description never reaches the page or a session's prompt.
- Merged on the remote (by anyone): the task is marked done, the session stops, the row reads "Merged by X" and the
  owner's checkout fast-forwards only when it is on the target branch with no tracked changes. No Apply, no Undo; Discard
  removes the worktree and keeps the claim.
- Closed without merging: Needs you "PR #N was closed by X", Apply refused, no more reads until the owner taps Reopen
  PR (`gh pr reopen`). Nothing reopens on its own.
- Blocked by a failed check: Needs you with a link per check and Send back, which gives the same session only the
  check's name and conclusion. Blocked by a review, pending checks or branch rules: the row stays Ready with the reason
  and Apply waits; a later clean read clears it.
- Behind with a clean merge: Update from main merges without a session turn (`merge --no-ff`, Orb's own commit), runs
  the declared test, then the push asks again. Behind with conflicting files is the collision.
