# The second panel shows what the main area doesn't

Orb has two levels of navigation: a rail of destinations, and a second panel that belongs to the screen in the main
area. The panel shows what the main area doesn't: when the main area is a list, the panel holds that list's
adjustments (filters, status, grouping, sorting, list actions); when it is one item (a session, a note, a task), the
panel holds that item's siblings so the owner can jump between them. Home has no panel. While the panel is open its
sibling order stays put, so a row never moves under the owner's finger.

## Considered Options

- **The panel is always about sessions** (as before): it was the same on every screen, so it never said where the
  owner was, and Recents reordered under the owner while they picked from it.
- **The panel is always adjustments for the current view**: clean for lists, but on a session there is little to
  adjust, and switching sessions would mean going back to a list first.

## Consequences

- iPad portrait stays one column: the panel opens as a sheet from the header instead of taking width.
- A session's siblings are grouped by state (waiting for the owner, running, finished since they looked), with the repo
  as a secondary label, not grouped by repo: the owner's work is cross-repo, and the state is what decides where to
  look next.
- The top bar says where the owner is, in the same two levels: "destination › item" ("Sessions › acme · fix login",
  "Brain › <note>"); tapping the destination goes back to its list, so it never says "No repo open". On iPad
  portrait it collapses to the item alone plus a back arrow.
- Session chips (context, MCP, model, approvals, New session) show only when the main area is a session, and describe
  that session alone; its branch, session id and model are a meta line under the item. Plan usage and mute are
  global. Approvals waiting in other sessions reach the owner through Needs you and the Home rail badge, never a chip.
- The "Home chat" chip appears exactly on the screens where the Home chat docks: Brain, Tasks, Routines.
  Not on Home (the chat is Home's own input) and not on a session (the session is the main area).
- "Panel" means only this second level, on the left next to the rail. The Home chat docks on the right. All four
  columns (rail, panel, main, docked chat) show only while the main area keeps at least 560 px (one CSS variable,
  tested by `spikes/screens.mjs`); otherwise the docked chat keeps its width and the panel folds into its header
  button as a sheet, because the panel is navigation reopened in one tap and the chat holds a draft and a
  conversation. iPad portrait: both are sheets, one at a time; the panel drops from the header, the Home chat rises
  from the bottom by the voice pill.
- The Home chat is one session and one transcript wherever it is shown: its draft and scroll carry across Brain,
  Tasks and Routines and into Home's own chat and back, and it knows which note, task or routine is on screen.
- Checked with `spikes/screens.mjs` at desktop, iPad landscape and iPad portrait in both themes before the look ticket
  closes.
- The Sessions list groups by state by default, like the siblings: Waiting, Running, Finished, Earlier (collapsed
  past 20 rows behind "show older"); a row is "repo · first request · when". Its panel holds a repo filter, "Group
  by repo" and "Search sessions". A session that changes state updates its word in place and moves group only after
  the owner leaves and comes back. Delegations show only as delegated (with their stage) or Ready, never Finished;
  the Home chat's vault sessions are never listed.
