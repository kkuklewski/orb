# Orb

A local page that drives Claude Code sessions across the owner's repos, by voice or text. Its Home is for triage and
delegation: across every inbox it says what the owner should take now, what to hand to a session, and what not to
forget.

## Language

**Owner**:
The one person Orb works for; every task, note, routine and session is theirs.
_Avoid_: User, client

**Destination**:
One of the rail's six places: Home, Sessions, Brain, Tasks, Routines, Settings. The destination and state words in
this glossary are also the spoken vocabulary, in Polish and English: voice navigation ("pokaż sesje", "open ready")
goes through a read-only `open_screen(destination, item?)` tool on the `orb` MCP server that the page follows, not a
keyword list in the page, so a new word here is a new word the tool understands. Every session gets the tool, since
speech goes to whichever session is on screen; the Home chat is where it is used most.
_Avoid_: Tab, view, section

**Session**:
One Claude Code conversation that works in a repo folder (a folder can hold several), listed in Sessions.
_Avoid_: Chat, agent, thread

**Home chat**:
The one place to talk to Orb itself: the session in the notes vault, shown on Home and as the panel over Brain. It is
never a row in Sessions. "Chat" means only this. It docks on the right of Brain, Tasks and
Routines (its chip shows only there), keeping one draft and transcript everywhere.
_Avoid_: Chats, Brain session, assistant

**Approval**:
A session stopped until the owner allows or denies one of its tool calls.
_Avoid_: Permission prompt, card

**Panel**:
The second level of navigation, left of the main area: a list's adjustments or an item's siblings. Home has none.
_Avoid_: Sidebar, drawer; never for the Home chat, which docks

**Brain**:
The destination for the owner's second brain: the notes waiting for a verdict, note tasks, recently changed notes.
Talking about it happens in the Home chat; new things reach it through a Drop on Home.
_Avoid_: Notes (as the destination), vault, knowledge base

**Note**:
One Markdown file in the second brain; the unit Brain lists and a verdict judges.
_Avoid_: Page, document, capture (unless it is one)

**Drop**:
A link or a file the owner drops (or pastes) on Home's drop zone. Orb picks its route by rules and runs it in the
background while the page stays on Home: a **job** Orb's own code runs (a YouTube link: its transcript saved as a new
note) or a **request** that starts a notes session with the drop's grant (a link saved to Brain or summarised, a file
read and sorted). The drop is the owner's approval for its own link or file only.
_Avoid_: Upload, import, capture

**Task**:
A Vikunja task, listed in Tasks. Vikunja is the owner's one task tracker: "Make it a task" creates one there.
_Avoid_: To-do, ticket, item

**Note task**:
A `- [ ]` line the owner wrote in a note, listed in Brain. Orb only ticks, drops or snoozes existing ones; it never
creates them, and they are never delegated.
_Avoid_: Task (alone), checkbox, vault task

**Routine**:
A scheduled cloud agent on claude.ai whose runs Orb watches.
_Avoid_: Cron job, scheduled task

**Needs you**:
An item that is blocked or broken until the owner acts, for a reason a plain rule can state: an approval, a failed
routine, a reminder due today or earlier, an overdue task, a broken setup (sign-in expired, Vikunja unreachable, a
chosen speech engine down, linking into Settings at the section that fixes it).
_Avoid_: Urgent, waiting, important

**Next action**:
The single item Home suggests the owner start now, after everything that needs them.
_Avoid_: Lead, top item, today's plan

**Up next**:
The few items ranked right after the next action.
_Avoid_: Queue, backlog, more

**Verdict**:
The owner's judgement on a note waiting for review: approve or reject. There is no defer: a note left alone waits,
and the nightly expiry closes it.
_Avoid_: Review, rating, score, defer

**Inbox**:
A source that keeps bringing the owner things to judge: notes waiting for a verdict, tasks, note tasks, routine
routine runs, pull requests.
_Avoid_: Feed, source, list

**Triage**:
Deciding, for each item from an inbox, whether the owner takes it now, delegates it, defers it or drops it.
_Avoid_: Review, sorting, planning

**Suggestion**:
The triage action a plain rule proposes for an item, shown in its destination's list for the owner to confirm, alone
or as a whole group. Notes: approve or reject from the vault's value-score thresholds; tasks: take now, delegate or later from the due
date and repo; note tasks: take now or later from the due date. Drop is never suggested.
_Avoid_: AI pick, recommendation, auto-triage

**Delegate**:
To hand an item to a new session that works on it while the owner stays where they are. Delegate needs a repo:
notes and note tasks are never delegated.
_Avoid_: Send to agent, assign, hand off

**Delegated**:
A session started by Delegate that has not finished yet.
_Avoid_: Background job, watching, in flight

**Queued**:
A delegation waiting for a free slot: at most three delegated sessions run at once, the rest start as earlier ones
finish.
_Avoid_: Pending, waiting, backlog

**Grant**:
The owner's one approval for what a session may do without asking again, given by the act that started it: a
delegation's grant (its own worktree, declared commands, its branch), a drop's grant (fetching its own link, reading its
own file). It belongs to that one session, is never stored and ends with it; the fence runs first.
_Avoid_: Auto-approve, bypass, trust

**Apply**:
Merging a delegated session's tested pull request into its repo; undone by reverting it.
_Avoid_: Accept, ship, approve

**Read**:
The owner opened a note itself and left it without a verdict (`owner_read`). Seeing its card or why-line on Home is
not reading it.
_Avoid_: Seen, viewed, opened

**Finished**:
A session that ended a turn the owner hasn't looked at yet; opening it clears it. The same word on Home and in
Sessions. A delegation's session is never Finished: it shows as Delegated, Needs you or Ready.
_Avoid_: Done, result, completed

**Ready**:
A delegation whose tested PR is up ("Ready: PR #N, tests passed"); its actions are Review and Apply.
_Avoid_: Result, done, finished

**Run**:
One run of a routine; the judge flags it worth reading or not. /r/<routine> shows its last run.
_Avoid_: Result, report, output

**Don't forget**:
The pane in Home's status card for things that wait quietly: dated reminders, pull requests going stale, repos with
unsaved work. A reminder due today or overdue moves to Needs you by rule.
_Avoid_: Watch, watchlist, reminders (for the whole pane)

**Routine state**:
The one word a routine's line shows: failed, stuck, missed, needs you (an ok run the judge found broken or wanting
action), worth reading, nothing to report, off. Routines are grouped in that order, by name inside a group. "Mark runs
read" clears only worth-reading; failures stay until a run succeeds.
_Avoid_: Status, result, health

**Badge**:
One of the rail's only two signals: the orange Needs you count on Home, and a quiet dot on Sessions while anything
is Running now. No other destination ever gets one; their counts live in Home's triage items.
_Avoid_: Notification, counter, unread

**Running now**:
The sessions that are working or waiting for an approval at this moment, across all repos.
_Avoid_: Activity, busy, live

## Retired

**Activity badge**, **Routines badge**:
Rail counts of busy sessions and of routine runs. Say **Badge**: only Home's Needs you count and Sessions' running dot.

**Watch**:
The old code name of Home's "don't forget" part (now `forget.py`, `home_forget`; Vikunja tasks moved to `home_tasks`). Say **Don't forget**.

**Result**:
Meant three things (a finished session, a routine run, a finished delegation). Say **Finished**, **Run** or **Ready**.
"Done" is only the triage action (Done / Later), never a session.

**Brain (session door)**:
The old Brain tab that opened a session in the notes vault. **Brain** is now the destination; talking to the vault is
the **Home chat**.

**Chats**:
The old name of the Sessions destination (`/chats`, which now redirects to `/sessions`). Say **Sessions**; "chat" is
only the **Home chat**.

**Activity**:
No longer a place in Orb. Say **Running now** for sessions working or waiting, **Needs you** for what waits on the owner.
