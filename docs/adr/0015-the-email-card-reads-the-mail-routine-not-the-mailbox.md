# The Email card reads the mail routine, not the mailbox

The owner wants the emails that need them on Home, one row each. Orb could read the mailbox itself (the claude.ai Gmail
connector in a locked-down session, or a mail token), or it could read what the owner's mail routine already wrote: a
claude.ai routine that reads the inbox every morning and opens its summary with a "Needs your attention" list. Orb shows
that list. It never reads the mailbox, so no mail credential or connector reaches the server, the work profile's "no
connectors" rule holds, and email text arrives only through the routines path, which is read-only and fenced as
untrusted data already.

## Consequences

- The card is only as fresh as the routine's schedule; an email the routine doesn't list never shows. Changing what
  counts as important is a change to the routine's prompt, not to Orb.
- Rows come from rules (`emails.py`), no model call, like Needs you (ADR 0001): the first heading that reads like
  "attention", "urgent" or "action", one row per bullet, urgent when the bullet says so or names a due date within
  `routines.URGENT_DAYS`. A routine that writes no such section gives no rows, and Orb doesn't guess.
- RemoteTrigger hands over about the first thousand characters of a result with newlines folded, so the list must come
  first in the routine's summary; a list cut short is marked on its last row.
- Done is Orb's own mark (a hash of the row's text, per run, in the routines state); it never touches the mailbox. The
  last row of a run done resolves that run's judged "action", the same mark as Mark resolved.
- Acting on an email happens in Gmail, by the owner: a row offers Open in Gmail, a plain link built by rule
  (`emails.gmail_link`). When the routine ends a bullet with the email's thread id (`[gmail:<hex id>]`, hidden from the
  row) the link opens that thread; else it searches for the first sender address the bullet names; with neither there
  is no link. Only checked pieces go into the URL, always `mail.google.com`; `gmail_account` (settings.json) picks the
  account. Archive or mark-read from Orb was considered (a card, then a session that may only change one approved
  thread's labels) and declined for now: it would bring a mail connector with write access into Orb.
