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
