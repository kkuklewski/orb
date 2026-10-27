# Rules may pin Needs you rows above the model's order

Amends ADR 0001. Two days away left Needs you with dozens of undecided rows: overdue tasks and routines with a
problem, a security alert among them. The model's order put security first when it ran, but a ranking can be stale,
failed or wrong, and then a security alert can sit below a month-old overdue task. So a rule may now pin a row: a
pinned row sits in a block at the top of Needs you's plan rows until it leaves Needs you, and the model orders only
inside that block and inside the rest. Pinning only orders; nothing is added, hidden or decided by it.

Pinned classes come from facts Orb already has or reads plainly, never from the model: security (a broken setup, or a
routine run the judge flagged as a security risk), client (an overdue task whose repo is a client folder) and money
(an overdue task with a pin label, `pin_labels`, default "money"; labels are only read).

## Consequences

- Age is counted from the due date (tasks, reminders) or from when the row entered Needs you (routines, setup; kept
  per row in `needs.json`, gone when the row leaves). Past ESCALATE_H (48 hours) a routine row turns red; a task or
  reminder turns red only when it is pinned too, so plain overdue tasks stay grey however old they are and red stays
  rare.
- The model sees each row's age in days, but age is not part of the fingerprint: a day passing never forces a new
  ranking. Age alone never moves an unpinned row.
- The Badge count never changes with age or pinning. A pinned row shows its class word, with no colour of its own.
- Nothing reaches the owner outside the page: no email, push or sound. The Badge and the Away recap stay the only
  signals (decided 2026-10-27); a channel outside the page would need its own decision and its own approval story.
