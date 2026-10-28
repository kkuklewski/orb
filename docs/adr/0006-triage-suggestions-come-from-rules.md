# Triage suggestions come from rules, and three delegations run at once

Triage at scale (14 notes, 9 tasks in one sitting) needs a suggested action per item so the owner confirms groups
instead of judging items one by one. The suggestion reuses rules that already exist instead of a new model call, so
it is free, instant and explainable in one line, and the owner's own pick always wins.

## Consequences

- Notes: the suggestion follows the vault's value rubric (`skills/value.md`, "Thresholds"): 4 or lower -> reject,
  8 or higher ("read today") -> approve, 5 to 7 -> no suggestion. The vault is the one source of the thresholds:
  Orb reads that line and falls back to the same numbers (4, 8) when it doesn't parse, never a setting of its own.
- A verdict is approve or reject, written to `human_verdict` (the value scorer calibrates on it). Defer is gone; a
  note left alone waits and the expiry (`auto_archived` after 14 days) closes it. "Restore" stays as the undo: it
  removes Orb's fields so the note waits again.
- Read is not a verdict: Orb sets `owner_read` only when the owner opens the note itself and leaves it without a
  verdict. Seeing its card or why-line on Home is not reading it.
- For verdicts, Orb writes exactly three frontmatter fields (`human_verdict`, `verdict_at`, `owner_read`), never
  the body, and commits nothing; this is item 1 of the allowlist in ADR 0007. Brain Capture `kind=review` stays the
  claude.ai path for verdicts; Orb doesn't call it.
- Tasks: no model call for the action. Overdue or due this week -> take now; repo known -> delegate; otherwise
  later. Drop is never suggested, only picked by the owner. "Suggest priorities" (one Haiku call) stays: it fills a
  priority, not an action.
- Note tasks: overdue or due this week (📅) -> take now, otherwise later. Never delegate, never drop.
- Triage happens in the destination's list, grouped by suggestion; Home keeps one queue item per inbox
  ("Triage 14 notes", "Triage 9 tasks", "Triage 4 note tasks"), never one merged count.
- Bulk Delegate raises one card with one grant per row (ADR 0005). At most three delegations run at once; the rest
  show as queued in the Delegated strip and start as earlier ones finish. Each ends as a PR the owner reviews and
  applies (ADR 0004), so the cap is also the cap on the owner's review load.
- No-topic captures (GLOSSARY) are picked by a rule too (age, kind, no deciding field), and Home's "N captures have
  no topic" is an Up next queue item, never Needs you; the owner decides each one on Brain, no suggestion.
