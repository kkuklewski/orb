# Plan: Orb's page to React + TypeScript + Vite

Status: plan only, nothing built. Checked 2026-10-23.

## Why, and what stays

The page is one 1,500-line `app.js` that builds the DOM by hand and keeps state in globals
(`S`, `Onb`, `Player`, `Mic`, `Rec`, `Slash`). It handles 41 server event types and sends 30 kinds
of messages. Bugs like the voice picker that didn't show loading, playing or errors come from that
state drifting out of sync with what's on screen. Components with typed state fix that whole class
of bug, and the app is going to grow.

**Stays:** the Python server (FastAPI, one WebSocket, the Agent SDK, fence, billing guard, speech,
Parakeet), its 128 tests, the WebSocket protocol, `vendor.py` (VAD and ONNX files, sha384-pinned),
and the Studio look (its CSS variables move over as they are).

**Not Next.js:** its route handlers can't hold a WebSocket ("connections close on timeout", per the
Next.js docs), and Orb needs no server rendering. Next.js would end up as `output: 'export'`, which is a
plain single-page app with more machinery. **Not a Node rewrite of the server:** the TypeScript Agent SDK has
the same features, but rewriting about 4,400 tested lines (and the security fence) buys users nothing.

## Stack (versions checked live)

| Piece | Choice | Why |
|---|---|---|
| Build | Vite 8 | Dev server with a WebSocket proxy, fast static builds |
| UI | React 19 + TypeScript 7 | Components and typed state |
| State | Zustand 5 | Small stores per area (connection, folders, session, speech, setup), no boilerplate |
| Markdown | `marked` + `dompurify` + `highlight.js` from npm | Bundled, so the CDN scripts and their CSP entry go away |
| Voice detection | `@ricky0123/vad-web` 0.0.31 from npm | Its wasm and model still come from `/static/vendor` (vendor.py) |
| Tests | Vitest for stores and the protocol, Playwright for the page | The existing `spikes/voice/run.mjs` becomes an E2E test |
| Node | 24 LTS (active until 2028-04-30) | Contributors only. Node 26 turns LTS on 2026-10-28; move when it has a patch release |

## Layout and build output

```
web/                      # the new front end (TypeScript)
  src/
    protocol.gen.ts       # generated from Python, never edited by hand
    ws.ts                 # one socket: token, same origin, reconnect, 4403 handling
    stores/               # connection, folders, session (chat), speech, setup
    audio/                # Player, Mic, Rec as plain TS modules (no React inside)
    screens/              # Setup, Chat, Sidebar, Settings, Sessions, Routines, Picker
    styles/studio.css     # today's tokens and rules, moved over
  vite.config.ts          # dev proxy: /ws (ws: true), /static/vendor, /api -> 127.0.0.1:8765
src/orb/static/app/       # Vite's build output, COMMITTED (see packaging)
```

- `vite build` writes hashed files to `src/orb/static/app/` with `base: "/static/app/"`.
- FastAPI serves `index.html` from there, keeps adding the build id and the CSP, and keeps
  `/static/vendor`.
- Development: `uv run orb` on 8765 plus `npm run dev` on 5173. Vite proxies `/ws` with `ws: true`.
  The server's same-origin check must accept the Vite origin in development only (an
  `ORB_DEV_ORIGIN` setting that is off by default), never with `rewriteWsOrigin`.

## Packaging for `uv tool install`

The `uv_build` backend packs every file under `src/orb/` into the wheel (it doesn't read
`.gitignore`) and has no build hooks. `uv tool install git+https://github.com/kkuklewski/orb` builds from
the committed tree, so users would need Node unless the built files are in git.

- **Commit the build output** (`src/orb/static/app/`, a few hundred KB). Users never need Node.
- CI: `npm ci && npm run build && git diff --exit-code src/orb/static/app` fails a pull request whose
  built files don't match its source.
- Later, optionally: publish wheels to PyPI or GitHub Releases and stop committing the build.
- The old `app.js` / `app.css` / `studio.css` stay until the switch (step 7), then are deleted.

## Typed WebSocket messages

One source of truth, in Python:

1. `src/orb/protocol.py`: a Pydantic model per server event and per page message, each with a
   literal `type` (`OpenedEvent`, `PermissionEvent`, `UserTextMessage`, …), grouped as
   `ServerEvent` and `ClientMessage` unions.
2. The server builds events through these models, so a wrong field fails a test, not the page.
3. `uv run orb-protocol` writes JSON Schema; `json-schema-to-typescript` turns it into
   `web/src/protocol.gen.ts` with discriminated unions on `type`.
4. CI regenerates both files and fails on any difference. A Python test checks that every
   `type` the server sends is in the schema.

Then `switch (ev.type)` in TypeScript is checked for every case, and adding an event on the
server without handling it on the page is a type error.

## Migration order (each step ships on its own)

The new page runs at `/next` next to the old one until step 7.

| Step | What | Done when |
|---|---|---|
| 0 | Scaffold `web/`, Vite proxy, build into `static/app/`, CI build check, `/next` route | Empty page connects and shows "online" |
| 1 | `protocol.py` + generated types, `ws.ts`, stores for connection and features | Typed events reach stores; Vitest passes |
| 2 | **Setup assistant** (self-contained, newest code, the most state) | Full first run on a fresh `ORB_STATE`, light and dark, phone width |
| 3 | Settings, Activity, Routines | Same screens and messages as today |
| 4 | Sidebar, repo picker, search, slash menu | Open, pin and start sessions; `/` menu with keyboard |
| 5 | **Chat**: streamed text and `<spoken>` blocks, markdown, tools, approval / plan / undo cards, history replay, notices | A typed and an approved turn match the old page |
| 6 | **Voice**: Player (audio queue, generations, browser voices), Mic (VAD), Rec (browser speech), voice pill, barge-in | `spikes/voice/run.mjs` passes: voice request, merge, barge-in |
| 7 | Switch `/` to the new page, delete `app.js`, `app.css`, `studio.css`, the CDN scripts and their CSP entry | Old files gone; CSP `script-src 'self' 'wasm-unsafe-eval'` |

Voice goes last on purpose. It's timing-sensitive and is already isolated (Player, Mic and Rec
don't touch the DOM much), so it moves as plain TypeScript modules with a small store bridge,
not as React components.

### Desk session (Home chat)

Home tiles (Needs you, Routines, Tasks, Notes, Don't forget, Not saved yet) carry "Ask about this →": it opens the
Home chat (`askIn(vault, question, {name, text}, true)`, the `routine.ts` pattern) with the tile's lines as the screen.
The Home chat itself has the `orb` read tools (`desk.py`), write tools behind cards, and `/today`, `/standup`,
`/task <id>` (precomputed on the server, vault session only).

### Rail and Sessions

The rail is Home, Sessions, Brain, Tasks, Routines, then Settings after a gap; under 900px (iPad portrait, phones) it is
a bar along the bottom and the side panel a drawer. It carries two signals only: Home's orange Needs you count and a
quiet dot on Sessions while a session runs or waits (**Running now**). Routines has no badge.

**Sessions** (`/sessions`) lists every session grouped by repo (repos with a waiting or running session first), with
status dots and a search box. Home's status card has a "Running now: N" line that opens it showing only the sessions
running or waiting. The old `/chats` and `/activity` (the latter filtered) land there and the address becomes
`/sessions`. The sidebar's Recents shows five (approvals and running sessions first) and an "All sessions →" link. The
side panel has its own small toggle at the top of the rail.

### Chat panel

The top bar's **Chat** chip (Home, Sessions, Routines) opens the current session's conversation (`ChatLog`) as a sheet over
that screen: it never shrinks the tiles, is full width on a phone, and has no input of its own, so the dock's composer and
voice pill stay the single input. "Open session →" goes to the full chat; Esc or ✕ closes it (Esc only when the composer
is empty). It adds no keyboard handler besides that one Esc listener; Space and the rest stay with the voice controller.

## Risks and how each is handled

- **Protocol drift** between Python and the page: generated types plus the CI diff check.
- **Voice timing regressions** (barge-in, the speech hold, echo guard): keep the logic as-is in TS
  modules; E2E with the WAV-as-mic spike before the switch.
- **Security:** the same-origin check, token and CSP stay server-side; the only change is a
  development-only origin setting, off by default.
- **Two front ends for a while:** only `/next` is new, and nothing on `/` changes until step 7.
- **Repository size:** the build output is small; the VAD/ONNX files stay out of git (vendor.py).

## Rough size

Steps 0–1 about a day; 2–4 two to three days; 5 two days; 6 one to two days; 7 half a day.
