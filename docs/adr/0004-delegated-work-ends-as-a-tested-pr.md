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
- A first push refused because the branch already exists on the remote with other commits is not a push failure:
  it raises "Branch X already exists on <remote> with someone else's commits; someone else may have delegated this
  task." with Discard only (nothing to merge, Apply refused). Discard is local; their branch stays. Once Orb has
  pushed the branch itself, a later refusal reads as a push failure (the session rewrote what it pushed; never forced).

## Amended (#866)

- Delegate claims the task in the tracker first; a task held by a teammate is refused, and Orb never takes it from
  them (#866). Its branch is per person: orb/<tracker user>/<task>-<slug>.
