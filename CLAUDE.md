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

The page is moving to React + TypeScript + Vite (`web/`, served at `/next`), screen by screen: see
`docs/react-migration.md`. Until step 7 the old page (`static/app.js`) is still the one at `/`.

Python 3.14 via `uv` (`.python-version` pins the patch). Front end is plain HTML/CSS/JS in
`src/orb/static/`, no build step. Tests run against a throwaway state folder (`tests/conftest.py`).

## Hard rules

- **Subscription only, never API keys.** Never set or request `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`.
  `billing.py` refuses to start with them, passes blank overrides to the SDK, and `check_init` stops a
  session whose `apiKeySource` is not `"none"`.
- **Never handle Claude credentials.** Sign-in is `claude auth login` (Anthropic's flow); `setup.py`
  only runs `claude auth status` and keeps `loggedIn`, the method and the plan. Don't modify or patch the
  Claude Code binary.
- **Bind 127.0.0.1 only.** Local speech engines (Whisper, Kokoro) are called only from the server.
- **Folders:** only the user's roots (`settings["roots"]`, set in onboarding). Never list or open
  `folders.SKIP_NAMES` (`secrets`, `node_modules`, …) or the user's `skip_names`.
- **Repo fence** (`fence.py`, PreToolUse with the vault rules): a session stays in its repo. Always
  denied: secret files, any `secrets/` folder in a root, the user's never-open names. Client folders
  (`settings["client_dirs"]`) are denied unless the session was opened inside that folder. Other repos
  in the roots get a card ("Other repo: <repo>. This session is in <repo>.").
- **Approvals stay on:** `permission_mode` is set explicitly (default `default`); tools go through
  `can_use_tool` -> Allow/Deny cards. Voice answers a card only when it can't be her own voice.
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
| `slash.py` | `/` menu: Claude Code's commands plus the app's own (`/clear`, `/model`, `/mcp`, `/rewind`, `/config` per repo); account-wide commands blocked |
| `routines.py` | optional Routines panel: claude.ai scheduled agents via a locked-down Haiku session (read actions only) |
| `brain.py` | optional second brain: notes vault rules, claude.ai Brain connectors, dictated notes |
| `timing.py` | per-turn hop timings: logged, shown under each answer, appended to `~/.orb/timing.jsonl` |
| `spoken.py` | `<spoken>` routing while streaming, fallback filter, Read all, `VOICE_PROMPT` appended to the `claude_code` preset |
| `folders.py` / `sessions.py` | repo discovery across roots, labelled by remote; folder -> sessions in `~/.orb/sessions.json` |
| `fence.py` | repo fence: file-tool paths and path-like words in Bash commands (follows `cd`) -> deny / ask |
| `speech.py` / `parakeet.py` | local speech: Parakeet first, Whisper + vocabulary when an unsure word sounds like a name; Kokoro client |
| `vendor.py` | downloads the VAD worklet, Silero model and ORT wasm, checks sha384 pins, serves from `/static/vendor` |
| `static/` | `index.html` (CDN scripts pinned + SRI), `app.js` (onboarding, chat, audio queue, VAD, browser speech, barge-in, voice pill); `app.css` (layout and components) + `studio.css` (the look: grey, hairline, one orange accent for state; dark and light) |

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
