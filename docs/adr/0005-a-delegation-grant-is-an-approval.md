# A delegation's grant is an approval, scoped to its worktree

"Approvals stay on" used to mean every tool call raises an Allow/Deny card. With several delegations running, that
floods Needs you. The rule is now worded precisely: every tool call goes through `can_use_tool`; a grant the owner
approved on its card may allow calls inside its own worktree; nothing else is allowed without asking. The grant is a
real approval card shown when the owner taps Delegate, not a bypass.

## Consequences

- A grant belongs to one delegation and ends with its session, or when the owner revokes it from the Delegated
  strip. It is never remembered for the next delegation.
- Allowed without asking: edits inside the worktree, the repo's own test and build commands, `git add` and
  `git commit` on its branch. Network installs, other paths and any other command still ask.
- Push and opening the PR are allowed only when the repo's "outward steps without asking" setting is on (default
  off); client repos always ask. Merge happens only through Apply.
- The repo fence still applies inside the worktree: secret files, any `secrets/` folder and the owner's never-open
  names stay denied whatever the grant says.
- Needs you shows one line per delegation ("acme · 3 approvals waiting"), not one per approval.
- CLAUDE.md's hard rule is reworded in the build ticket; the owner reviews that diff before it merges.
