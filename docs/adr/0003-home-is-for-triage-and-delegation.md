# Home is for triage and delegation

The owner is overloaded by several inboxes at once (notes waiting for a verdict, Vikunja tasks, note tasks, routine
runs, pull requests). Home's job is not to show those inboxes but to triage them: say what to take now, what to
delegate to a session, and what is worth watching, and let the owner hand pieces to sessions and still see the whole
picture. Every Home design choice is judged against that job; a screen that only lists an inbox belongs to its own
destination, not to Home. Delegate is the action the owner asked for on 2026-10-23: "ok, go to that repo and do it
for me", with a new session continuing there while they stay put.

## Consequences

- Next action and Up next items offer Delegate next to Start, Done and Later: Start takes the owner into the work,
  Delegate starts a session on it in the background and the owner stays on Home.
- Home shows a Delegated strip below Up next: one line per delegated session, saying in plain words what it is doing
  now and at what stage ("reading needs.py", "tests running", "waiting for your OK"), so the owner never has to ask.
  Its order stays put while the owner looks at it.
- The owner does not watch delegated work. It comes back once, through rules Home already has: a blocked session
  (waiting for an approval) lands in Needs you, one whose PR is up comes back as Ready in the queue.
- Ready is something to verify and apply, not just to open: its actions are Review and Apply. A delegation's
  session never shows as Finished: it appears only as Delegated, Needs you or Ready, so it never lands on Home twice.
