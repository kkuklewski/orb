# Orb shows the vault's expiry; it never archives

Notes pile up in the Notes list faster than the owner reads them. The vault already closes part of that pile on its
own: its nightly translate actor sets `auto_archived: <date>` on an AI page that nobody reviewed, read or vetoed, scored
4 or lower and older than 14 days (the vault's curation decision of 2026-10-19, amended 2026-10-25; `skills/value.md`,
"Expiry"). The owner's verdict there is a veto, not a gate. Orb's part is to make that veto visible before the page
goes, not to archive anything itself, so the vault stays the one place that decides what expires.

## Consequences

- Orb only reads `auto_archived`. It never sets or clears it, and ADR 0007's allowlist is unchanged. Bringing an
  expired page back is the vault's call (a follow-up on the vault side), not an Orb write.
- To show the window, Orb repeats the vault rule with one constant, `EXPIRY_DAYS`, whose comment names its source.
  When the two disagree, the vault wins: a page that carries `auto_archived` is expired whatever Orb computed.
- The veto is Keep, which is the approve verdict through `set_verdict`; opening the page (`owner_read`) also stops
  expiry, as before. No new write path.
- Only the vault rule's own pages expire. Raw Inbox captures and pages scored 5 to 7 never do; widening that is a vault
  decision.
- Expired pages stay listed read-only (the Expired view) and in the Away recap, both read from frontmatter only. The
  archive date is the vault's local day, so Orb compares days, never times.
