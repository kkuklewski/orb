# What Orb may write in the notes vault: one allowlist, in one module

Orb's own code writes to the owner's notes vault in a few places (verdicts, note-task lines), and Drop will add one
more. "Orb never edits the vault" was never true, and "only three frontmatter fields" would rule
out note tasks on Home. The rule is now an allowlist: what is on it Orb's code may write, nothing else, ever.

1. **Verdict fields**: `human_verdict`, `verdict_at`, `owner_read` in a note's frontmatter; "restore" removes them.
   Never the body (ADR 0006).
2. **Note-task lines**: one `- [ ]` line's marker and date (done `✅`, drop `❌`, snooze `⏳ <date>`); no other line.
3. **Drop** (ADR 0009): a dropped YouTube link's transcript, a new file in the transcripts folder (default
   `scrapers/Transcripts`), never an edit to an existing note; committed alone and pushed (the one place Orb commits).

## Consequences

- Scope: the allowlist binds Orb's own code, not sessions. The Home chat is a vault session and edits notes through
  its tools, under the repo fence and approval cards, like any session. This ADR does not mean "the Home chat may
  not write a note".
- Enforced in code: every vault write in Orb goes through one module, `vault_write.py` (`set_verdict`,
  `set_owner_read`, `set_task_line`). The old inbox append and its Undo are gone (the `inbox/Orb tasks.md` path is
  retired, ADR 0008). A task-line write may change only the marker and the done, not-doing and snooze dates. A new
  write path is a change to that module and a line in this ADR.
- Every write is compare-and-apply: only if the line or field still reads as Orb last saw it, otherwise nothing is
  written and the owner is told to look again. The VPS pushes the vault every 15 minutes and the owner pulls by
  hand, so a stale write is the real risk. A task line carries the line as the page showed it (`expect`); a verdict
  carries each note's verdict as the Notes list showed it (`seen`), and one changed note refuses the whole batch.
- Orb commits nothing but a drop's own new transcript (ADR 0009); the owner commits the rest of the vault.
