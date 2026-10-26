# Needs you comes from rules; the model only orders and explains

Home's "Needs you" must never miss or delay something that is blocked or broken, and a model call runs at most every
20 minutes and can be wrong or unavailable. So plain rules decide what needs the owner (approvals first, then failed
or broken routines, then overdue tasks) and show it at once; the model may only reorder those items and give each a
short reason. We rejected letting the model pick the items: it would hide a new approval or failure until its next
call, and a confident wrong ranking would look like "nothing needs you".

## Consequences

- If the model call fails or is stale, Home shows the rule order, not an empty card.
- Everything that is not blocked or broken (tasks without an overdue date, note tasks, results, pull requests, notes
  waiting for a verdict) belongs to the next-action queue, not to Needs you.
