# CLAUDE.md

Orb: a local page (FastAPI + one WebSocket) that drives Claude Code through the Python Agent SDK, with
voice in (browser speech, or local Parakeet / Whisper) and voice out (browser voices, or local Kokoro).
Public repo: no personal data in tracked files (run `scripts/check-public.sh` before a push).

## Commands

```sh
uv run orb                  # serve on 127.0.0.1:8765, prints the link with the token
uv run pytest               # unit tests (billing guard, repo fence, spoken split, folders, sessions, voice merge)
scripts/check-public.sh     # fails on private markers (~/.orb/private-markers, .private-markers)
cd web && npm run dev       # React page with live reload (server: ORB_DEV_ORIGIN=http://localhost:5173 uv run orb)
cd web && npm run build     # builds into src/orb/static/app; commit the result (CI fails if it's stale)
```

The page is React + TypeScript + Vite (`web/`, built into `src/orb/static/app`, served at `/`; `/next/...` links
redirect). See `docs/react-migration.md`.

Python 3.14 via `uv` (`.python-version` pins the patch). Front end: `web/` (React + TypeScript + Vite); its build
output in `src/orb/static/app/` is committed. Tests run against a throwaway state folder (`tests/conftest.py`).

## Hard rules

- **Subscription only, never API keys.** Never set or request `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`.
  `billing.py` refuses to start with them, passes blank overrides to the SDK, and `check_init` stops a
  session whose `apiKeySource` is not `"none"`.
- **Never handle Claude credentials.** Sign-in is `claude auth login` (Anthropic's flow); `setup.py`
  only runs `claude auth status` and keeps `loggedIn`, the method and the plan. Don't modify or patch the
  Claude Code binary.
- **Bind 127.0.0.1 only.** Local speech engines (Whisper, Kokoro) are called only from the server.
- **Profiles** (`settings["profile"]`, `settings.py`): `work` is a new install's default and is enforced in
  `Settings.__getitem__`: no claude.ai connectors (`ENABLE_CLAUDEAI_MCP_SERVERS=false`), no browser speech
  recognition (Chrome sends the audio to Google), every other repo fenced like a client folder, no `*.ts.net`
  host. `personal` (an install from before profiles) allows them. In personal, sessions still load no
  connectors unless `brain` (Brain's tools only, a PreToolUse hook denies the others) or `connectors` is on.
- **Folders:** only the user's roots (`settings["roots"]`, set in onboarding). Never list or open
  `folders.SKIP_NAMES` (`secrets`, `node_modules`, …) or the user's `skip_names`.
- **Repo fence** (`fence.py`, PreToolUse with the vault rules): a session stays in its repo. Always
  denied: secret files, any `secrets/` folder in a root, the user's never-open names. Client folders
  (`settings["client_dirs"]`) are denied unless the session was opened inside that folder. Other repos
  in the roots get a card ("Other repo: <repo>. This session is in <repo>."); in the work profile they are
  denied like client folders (the vault session may still read them with a card).
- **Approvals stay on:** `permission_mode` is set explicitly (default `default`); every tool call goes
  through `can_use_tool` -> an Allow/Deny card. A delegation's **grant** is itself an approval (ADR 0005):
  the owner allows it on the Delegate card, it belongs to that one session and is never stored or carried
  over, and it lets only its covered calls pass without a card (edits in its worktree, the repo's declared
  test/build commands, `git add`/`commit` on its branch; push and its PR only with the repo's `outwardSteps`
  on, never in a client folder; merge only through Apply). The fence runs first and its denials are final;
  revoking the grant brings the cards back. A Home **drop** is the approval for its own link or file only (ADR 0009):
  fetch that URL, one Brain Capture link of it, read that file; a YouTube drop is Orb's own job (new transcript note,
  that one file committed and pushed). Voice answers a card only when it can't be her own voice.
- No personal data in code, tests or docs: use made-up names (acme, globex). Personal setup lives in
  `~/.orb/settings.json`.

## How it fits together

| File | Role |
| --- | --- |
| `server.py` | FastAPI app, `/ws` (token + same-origin check), CSP, `Hub` (connections, folder sessions, idle cap), onboarding gate |
| `setup.py` | onboarding checks: Claude Code sign-in status, folder suggestions, speech engines |
| `settings.py` | `~/.orb/settings.json` (0600): roots, never-open names, client folders, vault, speech engines, defaults |
| `agent.py` | `FolderSession`: one `ClaudeSDKClient` per folder, stream -> page events, approvals, history replay; `Speaker` (sentence queue -> Kokoro or browser `speak` events, generations); `VoiceInput` (merges paused speech, audio or browser text) |
| `chain.py` | front model per folder (Sonnet default, effort `ORB_SONNET_EFFORT`), `opus-coder` subagent, routing prompt, "switch to Opus" |
| `slash.py` | `/` menu: Claude Code's commands plus the app's own (`/clear`, `/model`, `/mcp`, `/rewind`, `/config` per repo: mode, model, outward steps, apply mode, test/build commands); account-wide commands blocked |
| `gate.py` | tool gate (ADR 0011): one `Gate` per session, `decide(tool, input)` -> a typed `Decision` (allow / ask / deny / pass): connectors that are off, the Capture guard, handoff and tracker-write cards, fence + vault rules (`vault_rule`: protected vault files ask) + `push_rule` (force-push denied in every session, an unusual push asks; strictest), then the session's grant (`cover`); runs once, in the PreToolUse hook (a covered call is a hook allow; `can_use_tool` only raises cards, its note = `decision_reason`); `hook_output` is the only place the SDK's hook dict is built |
| `shell.py` | one reading of a Bash command (`read(cmd)`, cached): read-only or not, path-like words and `cd`, recursive, plain words, Claude Code's heredoc commit, push verdict; every answer fails closed. The fence, the vault rule and the grant all ask it |
| `grant.py` | a delegation's grant: what the tool gate's `cover` allows without a card (fence first; worktree edits, declared commands, commits on its branch, push/PR only with `outwardSteps`); per-repo `outwardSteps`/`test`/`build` live in `/config` |
| `handoff.py` | `continue_in_repo` tool (in-process MCP): the session's Claude asks to continue in another repo; Allow card, then `Hub.handoff` opens a new session there (pages follow), first request = the brief |
| `desk.py` | the Home chat's (vault session) dashboard tools on the `orb` MCP server: read tools (`home_brief`, `tasks`, `task`, `sessions`, `routines`, `notes_recent`, `unsaved`) are pre-allowed and every result is fenced as untrusted data; write tools (`task_done`, `task_snooze`) always raise a card and return the re-read state |
| `navigate.py` | `open_screen(destination, item?)` on the `orb` MCP server, every session, pre-allowed: checks the glossary destination and item (PL/EN words), sends `navigate` to the pages showing that session; a refusal is a line to say, nothing moves |
| `suggest.py` | triage suggestions from rules (ADR 0006): a task's take now / delegate / later (due within a week, known repo), a note task's take now / later (📅); on Home's plan items; a waiting note's approve / reject from the vault rubric's thresholds (fallback 4/8), grouped on Brain with Apply suggestions (`brain_apply`, each note on its own) and Restore; never Done or Drop |
| `routines.py` | optional Routines panel: claude.ai scheduled agents via a locked-down Haiku session (read actions only) |
| `tracker.py` / `jira.py` | the task tracker (ADR 0010): `tracker.py` picks Vikunja (`vikunja.py`) or Jira Cloud (`jira.py`, REST v3; Jira when `jira_url` is set) and every caller goes through it with the settings dict; tokens only from env (`ORB_VIKUNJA_TOKEN`, `ORB_JIRA_EMAIL` + `ORB_JIRA_TOKEN`); repo map from the vault's `vikunja_project` / `jira_project` |
| `make_task.py` | "Make it a task" on a routine's run (ADR 0008): a page card names the title and the tracker's project (the repo's mapped project, else `tasks_inbox`, default "Inbox"); Allow creates the task (in Vikunja or Jira), Undo deletes only a task this server created |
| `intake.py` | Home's drop zone (ADR 0009), in the background: a link or file -> a route (first match wins). YouTube = Orb's job (the vault's fetch script from settings `transcript_script`, run only while git tracks it unchanged; new note in `transcripts_folder` via `vault_write`, that file committed + pushed, refused while the vault's git config runs commands); https -> a notes session saving a Brain Capture link; else a summary; text / PDF / image files saved 0600 under `~/.cache/orb/drops` (30 days). Sessions get a `DropGrant` for just that URL / file (Capture only on the link route) and end the drop with their first turn (`drop_done`); a new kind is one more `Route` |
| `brain.py` | optional second brain: claude.ai Brain connectors, dictated notes (Capture guard) |
| `vault_write.py` | the only writer of Orb's code to the notes vault (ADR 0007): verdict fields, `owner_read`, one task line's marker and date (compare-and-apply, atomic); a drop's new transcript, committed alone (ADR 0009) |
| `timing.py` | per-turn hop timings: logged, shown under each answer, appended to `~/.orb/timing.jsonl` |
| `spoken.py` | `<spoken>` routing while streaming, fallback filter, Read all, `VOICE_PROMPT` appended to the `claude_code` preset |
| `folders.py` / `sessions.py` | repo discovery across roots, labelled by remote; folder -> sessions in `~/.orb/sessions.json` |
| `fence.py` | repo fence: file-tool paths and path-like words in Bash commands (`shell.read`, follows `cd`) -> deny / ask; a registered worktree counts as its repo |
| `worktree.py` | a delegation's git side: worktree + branch from a snapshot (owner's tree untouched), push (only the branch, no force, never a snapshot branch), Apply (squash/merge via `merge-tree`, conflict touches nothing), revert, remove; registry `~/.orb/worktrees.json`; repo hooks off |
| `delegation.py` | Delegate a task (Vikunja or Jira): grant card -> worktree + background session with the grant + the task as brief; after each turn Orb runs the declared test itself (Ready / failed); then, with a remote, push + `gh pr create` behind a Needs you card (or at once with the repo's `outwardSteps`, never in a client folder); Review, Apply (local merge, task done; the PR stays open), Undo, Discard; records in `~/.orb/delegations.json`, a restart marks running ones stopped; the Delegated strip on Home |
| `speech.py` / `parakeet.py` | local speech: Parakeet first, Whisper + vocabulary when an unsure word sounds like a name; Kokoro client |
| `vendor.py` | downloads the VAD worklet, Silero model and ORT wasm, checks sha384 pins, serves from `/static/vendor` |
| `static/` | `app/` (the built React page, committed; `npm run build`), `icons/` + `manifest.webmanifest` (home-screen install), `vendor/` (VAD worklet, Silero model, ORT wasm from `vendor.py`). No CDN scripts. |

Sessions: a folder has several sessions (`sessions.json` v2: key, resume id, label = first request).
A page shows one session (`Conn.key`) and the others keep running. Background news (`done` /
`approval`) goes to other pages as `bg_notice`. Idle sessions close after 30 min; a running turn, an
open card or a running Opus task is never closed. After a restart a resumed session is told which
background tasks were stopped.

Speech generations: every new turn, interrupt and barge-in bumps `Speaker.gen` and sends
`speech_reset`; the page drops audio from older generations. Barge-in: `speech_start` on the first
speech frame, `barge_in` after 300 ms of real speech while she plays; `auto` arms only with headphones.

## Verification

- `spikes/ws_client.py` drives a turn over the WebSocket like the page.
- `spikes/voice/run.mjs` runs real Chrome with a WAV file as the mic (voice request, barge-in, merge).
- `spikes/screens.mjs` screenshots desktop / iPad / phone in both themes.
- A fresh install: `ORB_STATE=$(mktemp -d) ORB_PORT=8766 uv run orb` shows the onboarding.

## Agent skills

### Issue tracker

Tasks live in the Vikunja project `orb` (via the `vikunja` MCP tools), not GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles as Vikunja labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
