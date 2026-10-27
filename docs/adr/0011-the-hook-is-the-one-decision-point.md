# The hook is the one decision point; a grant-covered call is a hook allow

Extends ADR 0005. A tool call used to be decided in two places: the PreToolUse hook ran the repo fence and the vault
rules (and the Capture guard, the handoff and tracker-write cards), then `can_use_tool` ran the fence again to check
the session's grant and once more for the card's note. The same Bash command was read by three parsers, and the
fence could run four times for one call. Now one tool gate (`gate.py`, one per session) decides every call, once, in
the hook. `can_use_tool` only raises cards.

The Agent SDK's order makes this safe: hooks, then the settings' deny and ask rules, then the permission mode, then
allow rules, then `can_use_tool`. A hook "allow" skips `can_use_tool`, but not the settings' deny and ask rules,
plan mode's block on file edits, or Claude Code's own check on removing critical paths. A hook "ask" reaches
`can_use_tool` with the hook's reason as `decision_reason`.

## Consequences

- A deny from the gate is final: the fence's word (secret files, `secrets/`, never-open names, client folders), a
  force-push, a connector that is off, a refused Capture.
- A call the grant covers is a hook "allow" carrying the grant's safe input (sandboxed declared commands, git with
  the repo's hooks off). The fence still runs first; an "ask" from the fence or the vault rules is never covered.
- Every other call is an "ask" (with the gate's reason) or has no objection; either way `can_use_tool` raises the
  card, and the card's note is `decision_reason`, not a second run of the fence.
- The hook has to see every tool a grant can cover (a drop's WebFetch included), so its matcher covers them.
- Force-pushing is denied in every session, not only the notes vault's; the message says so ("Force-push is blocked
  in Orb").
- The SDK's hook dict and `PermissionResult` are built only where Orb meets the SDK; inside, the gate returns a
  typed `Decision`.

## Deviations

Found while building it, kept on purpose:
- `Gate.decide(tool, input)` takes no `tool_use_id`. The session keeps the hook's decision by `tool_use_id`
  (`FolderSession.decided`) and `can_use_tool` reads it from there, so the gate runs once per call: a drop's grant
  uses up its one Capture in `covers`, and the Capture guard pops the queued note.
- `Decision` has a fourth kind, `pass` (no objection). It differs from `ask`: the permission mode may still allow it.
- `Decision` carries `covered` (the grant allowed it) and `title` (a tracker write's task, for the card).
- Step 1 changed no behaviour: a covered call was still allowed from `can_use_tool` and the card's note still came
  from the fence, until the hook became the one decision point (step 3).
