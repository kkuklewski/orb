# Orb sets a bad state file aside; it never resets it silently

Orb runs alone for hours and keeps its own state in its state folder: settings, sessions (resume ids), delegations,
worktrees, Needs you, routines, the Away recap and a few caches. Writes were already safe (one atomic writer,
`config.write_private`). Reads were not: every store caught a bad file and started empty, and its next save overwrote
the bad file. A damaged `sessions.json` lost every session's resume id with no trace and no word to the owner.

Now every store reads through one loader, `config.read_state`. A file that is missing is a first run. A file that is
not JSON, has the wrong shape or can't be read is **set aside**: renamed `<name>.bad-<time>` in the same folder, and the
store starts from its default. Orb never edits, repairs or chmods it; what to do with the copy is the owner's call.

## Consequences

- Start-up never blocks on a bad file. Even a bad `settings.json` only means the defaults (the work profile and
  onboarding), which are the safest state.
- Precious files (settings, sessions, delegations, worktrees: losing them loses work) become a Needs you setup row
  naming the file and its copy. The other stores (rebuildable caches and marks) only log a warning. No new channel:
  ADR 0012's Badge and Away recap stay the only signals.
- The newest three copies per file are kept; older ones are deleted, so a file that keeps going bad can't fill the
  disk.
- If the rename itself fails, Orb logs it and runs on with the default; that file's next save overwrites it.
- Stores that only grow get a stated bound: `timing.jsonl` keeps its newest lines, routines' state keeps what the
  failure streak and the result screen read. Delegations stay unbounded (a record leaves on cleanup).
