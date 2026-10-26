# Vikunja is the one task tracker; Orb never creates note tasks

"Make it a task" wrote a `- [ ]` line into `inbox/Orb tasks.md` in the vault, while Brain Capture `kind=task` becomes a
Vikunja task (the owner's inbox project, created by a nightly job outside Orb). So "make a task"
landed in a different place depending on where the owner said it, and a vault file became a second task list, the
thing the owner had moved away from. The file was never created, so the path was never used.

## Consequences

- "Make it a task" (a routine's run, and anywhere else it appears) creates a Vikunja task directly through
  `vikunja.py`, which gains create, and delete for Undo. Project: the mapped project when the item has a repo
  (`repo_map`), otherwise the inbox project (settings `tasks_inbox`, default "Inbox", Vikunja's own first project). The label stays "Make it a task".
- It is a write: it raises a card like `task_done`, and Undo deletes the task it created (Orb keeps the returned id).
- Note tasks are only the lines the owner writes in notes; Orb ticks, drops or snoozes them (ADR 0007), never adds one.

Later: ADR 0010 lets Jira Cloud stand in for Vikunja. "One task tracker" still holds: whichever is set up.
