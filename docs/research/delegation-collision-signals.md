# What git and gh say when main moved (ticket 862)

Research for map 861 (several people, one Orb each, same repos). It covers the signals git and gh give when the
target branch moved under a delegation or the branch no longer merges, and where Orb reads them today. Inputs for
the conflict rule (863) and the base of a delegation (864). No code changes.

Method: read `src/orb/worktree.py` and `src/orb/delegation.py` at `70c4890`. Then reproduced each moment with a
bare remote and two clones (git 2.51.0), read live PRs with gh 2.96.0, and checked GitHub's docs for the enums.

## Answers

1. **Orb never fetches.** No `git fetch`, `ls-remote` or `remote update` runs anywhere in `src/orb`.
   - `worktree.create` (`worktree.py:190`) branches from the local `HEAD`, or from a snapshot commit on top of it
     (`_snapshot`, `worktree.py:169`).
   - The base is therefore as old as the owner's last pull. It can be any number of commits behind `origin/main`, and
     Orb has no way to know how many.
   - `worktree.unpushed` (`worktree.py:263`) counts against `refs/remotes/<remote>/<into>`, so it is also only as
     fresh as the last fetch.
2. **A rejected push reports the wrong line.**
   - `_git` (`worktree.py:121`) keeps only the last line of stderr. For a rejected push that line is a hint:
     `git push failed: hint: See the 'Note about fast-forwards' in 'git push --help' for details.`
   - The line that matters is ` ! [rejected]        orb/1-x -> orb/1-x (fetch first)`. Git prints `(non-fast-forward)`
     instead when the local repo already has the remote tip.
   - `_publish` (`delegation.py:515`) stores the hint line as `outward_problem`, and the record stays Ready with
     `outward="failed"`.
   - `git push --porcelain` gives one line per ref that can be parsed:
     `!	refs/heads/orb/1-x:refs/heads/orb/1-x	[rejected] (fetch first)`. The exit code is 1 in both forms.
   - A delegation branch is a new ref, so its first push **succeeds even when main has moved**. The push is not a
     signal for "main moved". It is rejected only when the same branch name already exists on the remote with other
     commits (see 5).
3. **`gh pr view --json mergeable,mergeStateStatus`.** These are GitHub's GraphQL enums.
   - `mergeable`: `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` ("still being calculated").
   - `mergeStateStatus`: `CLEAN`, `DIRTY` (the merge commit cannot be created cleanly), `BEHIND` (the head ref is out
     of date), `BLOCKED`, `UNSTABLE` (non-passing checks), `HAS_HOOKS`, `DRAFT` (deprecated; use `isDraft`), and
     `UNKNOWN`.
   - **Computed lazily.** GitHub starts a background job when a PR is created, edited or read and its value is
     unknown. The REST docs say to "resubmit the request after the job completes". So a read right after
     `gh pr create` or a push can return `UNKNOWN`, and the read itself starts the computation. No duration is
     documented, and none was measured here because that would need a throwaway PR on the public repo. Poll with a
     backoff (2 s, 5 s, 15 s), and treat `UNKNOWN` as "not yet" rather than as an answer.
   - **A merged or closed PR reads `UNKNOWN`/`UNKNOWN`.** Live example: kkuklewski/orb#14, merged.
   - **A conflict reads `CONFLICTING`/`DIRTY`.** Live example: kkuklewski/orb#6.
   - **`BEHIND` appears only when branch protection requires up-to-date branches.** kkuklewski/orb#13 is 2 behind main
     (`gh api repos/kkuklewski/orb/compare/main...feat/prune-caches` gives `behind_by: 2`). main is unprotected,
     and the PR reads `CLEAN`/`MERGEABLE`. Without protection, "behind but not conflicting" is not visible in these
     fields. Use `compare ... --jq .behind_by` (no fetch) or `git rev-list --count <branch>..origin/<into>` (after a
     fetch).
   - Orb reads none of these fields today. The only `gh` calls are `pr create` (`delegation.py:109`), `pr view --json
     body` (`items.py:108`) and `search prs` (`forget.py:147`).
4. **Apply against a stale local main succeeds, and the conflict surfaces later, outside Orb.**
   - `apply` (`worktree.py:296`) runs `git merge-tree --merge-base=<wt.base> HEAD <branch>` against the checkout's
     local `HEAD`.
   - Reproduced: a teammate changed line 1 on `origin/main`, and the delegation changed the same line. `merge-tree`
     exits 0 and Apply fast-forwards the local main.
   - The owner's next `git push` is then rejected with `(fetch first)`. After a fetch, `git status -b` reads
     `[ahead 1, behind 1]`, and `git merge-tree main origin/main` exits 1 and lists `f.txt`.
   - The same Apply computed against `origin/main` (after a fetch) would have exited 1 before anything moved.
   - The record is already `applied`, the task is done in the tracker, and the worktree is removed. Undo
     (`revert`, `worktree.py:318`) still works locally, but the conflict is now the owner's to resolve by hand.
   - The local moments are already safe. The owner's own commits on local main after delegating are handled by
     `--merge-base=wt.base`. Uncommitted edits in a touched file make `merge --ff-only` refuse with
     "Nothing changed: ...".
5. **Teammates' work reaches Orb only through the remote.** Nothing in Orb reads another machine's state, and the
   tracker carries task state, not code. There are two paths, plus one collision:
   - The owner's own `git pull`/`fetch`, done by hand. Orb never pulls.
   - The PR on GitHub, whose mergeability Orb does not read.
   - **A branch-name collision.** `branch_name` (`worktree.py:161`) is `orb/<task>-<slug>`, the same on every Orb.
     Two people who delegate the same task push the same ref. The second push is rejected with `(fetch first)`; see
     2 for how that is reported. If it were not rejected, `gh pr create` would fail because a PR for that branch
     already exists. `_branch_exists` checks local branches only. This is where task claiming (866) and the
     conflict rule meet.

## Moments, signals, commands

| Moment | Signal | Command (no side effects unless noted) | Orb today |
| --- | --- | --- | --- |
| Delegate: is the base behind the remote? | remote tip ≠ local tracking ref | `git ls-remote <remote> refs/heads/<into>` vs `git rev-parse <remote>/<into>`; after `git fetch <remote> <into>` (updates refs): `git rev-list --count HEAD..<remote>/<into>` | not checked (`worktree.py:190`) |
| Push of the delegation branch | exit 1, `[rejected] (fetch first)` or `(non-fast-forward)` | `git push --porcelain <remote> <c>:refs/heads/<b>` | last stderr line kept: a hint (`worktree.py:121`, `:269`) |
| PR open, main moved, conflicts | `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY` | `gh pr view <n> --json mergeable,mergeStateStatus,baseRefOid,headRefOid` (poll while `UNKNOWN`) | not read |
| PR open, main moved, no conflict | `BEHIND` only with "require up to date" protection; otherwise `CLEAN` | `gh api repos/<o>/<r>/compare/<into>...<b> --jq .behind_by` | not read |
| Ready, before Apply | merge-tree against the remote tip exits 1 + file list | `git fetch <remote> <into>` then `git merge-tree --write-tree --name-only --no-messages --merge-base=<wt.base> <remote>/<into> <b>` | merge-tree against local `HEAD` only (`worktree.py:279`) |
| After Apply, owner pushes | exit 1, `main -> main (fetch first)` | (owner's own push) | outside Orb; record already `applied` |
| Who landed first | commits on the remote not in the base, with author and time | `git log --format='%h %an %cI %s' <wt.base>..<remote>/<into> -- <conflicting files>` | not read |

## Notes for 863 and 864

- **A fetch is the one new remote contact these signals need.** `ls-remote` and `gh` reads are the other two.
  ADR 0004 says push is "the only call that contacts a remote". A fetch is a read, but it is still an outward call
  and needs a line in the ADR. Unlike `git pull`, `git fetch <remote> <into>` changes only
  `refs/remotes/<remote>/<into>`, and never the owner's branch or tree.
- **Fix the push error line whatever 863 decides.** Pick the `[rejected]` line, or use `--porcelain`, instead of the
  last stderr line.
- **"Who landed first" comes from git** (`git log <wt.base>..<remote>/<into> -- <files>`), not from GitHub. It
  works for hand edits and other Orbs alike, which matches 861's "same other side".

Reproduction script used: a throwaway bare remote plus two clones. It is not committed; the steps are the commands
above.
