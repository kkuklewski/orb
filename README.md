# Orb

Talk to Claude by voice, in the code repos you choose. Orb is a small local web app: pick a repo,
press Talk, and talk. Claude answers out loud with a short summary and shows the full answer in
the chat. Under the hood it runs [Claude Code](https://code.claude.com) through the Claude Agent SDK,
so it can read your code, run commands and make changes. Every change asks you first.

You don't need to write code to use Orb. You type four commands in Terminal once to install it; after
that it is a page in your browser.

Powered by Claude. Orb is not made by or affiliated with Anthropic.

## What you need

- A Mac (Orb is built and tested on macOS; Linux may work, Windows is untested).
- A **Claude Pro or Max** subscription.
- Chrome or Safari.
- Your projects as git repos in a folder on this Mac (for example `~/Projects`).

Claude Code and Python come with the install; you don't install them yourself.

## Install

1. **Open Terminal.** Press ⌘ Space, type `Terminal`, press Return. Paste each command below and press
   Return after it.

2. **Install uv** (the tool that installs Orb and its Python):

   ```sh
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

   Then quit Terminal (⌘ Q) and open it again, so it finds `uv`.

3. **Install Orb:**

   ```sh
   uv tool install git+https://github.com/kkuklewski/orb
   ```

   If macOS asks to install the "command line developer tools", click Install, wait for it to finish,
   and run the command again.

4. **Start Orb:**

   ```sh
   orb
   ```

   It prints a link like `http://127.0.0.1:8765/#t=…`. Hold ⌘ and click it (or copy it into Chrome or
   Safari). Leave the Terminal window open: closing it stops Orb.

## First start

The first time, a short setup runs in the page:

0. **Work machine or personal.** Work (the default) keeps the install clean: no claude.ai connectors in
   sessions, speech recognition only on this Mac, a session never reaches another repo, the page answers on
   this Mac only. Personal allows Brain and your other connectors (when you turn them on), browser speech, an
   approval card before another repo, and Tailscale serve. Settings → This Mac switches it.
1. **Sign in to Claude.** Orb shows the command to run in Terminal (open a second window with ⌘ N). You
   sign in in Anthropic's own browser window. Orb never sees, stores or forwards your login. It only checks
   that Claude Code is signed in with a subscription, and which plan.
2. **Choose the folders Orb may open.** Orb lists the git repos inside them. A conversation stays in
   its own repo; on a work machine another repo is off limits, on a personal one it needs your OK.
3. **Voice.** Speech recognition runs on your Mac (see [Local speech](#local-speech)); until it is
   installed, type.
4. **How it keeps you in control.** Then you're in.

The link carries a private access token, and Orb makes a new one every time it starts. So after a
restart, open the new link: `orb open` in Terminal opens it. An old tab or bookmark tells you to.

## Every day

| What | How |
| --- | --- |
| Start | Run `orb` in Terminal and open the link it prints. |
| Open the page | `orb open` opens the running Orb's page, also when it started at login or in another window. |
| Stop | Press Control C in that Terminal window, or close it. |
| Start it at login | Run the command below once. Orb then runs in the background and restarts after a crash. |
| Update | `uv tool upgrade orb`, then start it again. |
| Uninstall | `uv tool uninstall orb`. Your settings stay in `~/.orb`; delete that folder to remove them too. |

Start at login (macOS):

```sh
curl -fsSL https://raw.githubusercontent.com/kkuklewski/orb/main/deploy/install-launchd.sh | sh
```

Then open the page with `orb open`. Run the command again after you add or change a tracker token (see
[Tasks](#tasks-vikunja-or-jira)); it replaces the job. To undo it:
`launchctl bootout gui/$(id -u)/dev.orb.server && rm ~/Library/LaunchAgents/dev.orb.server.plist`.

## Using it

| Action | How |
| --- | --- |
| Pick a repo | "+ New" lists every repo in your folders. Pin the ones you use. |
| Talk | Click Talk or press Space. Each pause sends a request; short pauses mid-sentence are fine. |
| Type | The box at the bottom. `/` opens commands: your Claude Code skills, `/clear`, `/model`, `/config`. |
| Approve a tool | Allow / Deny on the card, or say "yes" / "no" (with headphones). |
| Stop her | Esc or ■. With headphones you can just talk over her. |
| Hear the whole answer | "Read all" under an answer. |
| See what needs you | Home: approvals, failed checks and overdue tasks first, then what to take now or hand off. |
| Hand off a task | Delegate on a task: a separate session works on it in its own copy of the repo, runs the repo's tests, and comes back Ready for you to Review and Apply. |
| Settings | Voice, approvals and model for new folders, vocabulary, dark or light, and "Open setup" to change your folders. |

## Working with a team

Each person runs their own Orb on their own Mac, in the same repos (one GitHub remote) and the same task
tracker. There is no shared server; git and the tracker are where you meet.

- **Claims.** Delegate assigns the task to you in the tracker before work starts. A task a teammate holds
  reads "Held by <name>" and can't be delegated. Orb never removes a teammate's assignment.
- **Pull requests.** When the tests pass, Orb asks "Push branch X and open a PR?" (or does it at once if
  you turned on outward steps for that repo in `/config`). Each person's branches carry their own name.
- **Apply** merges the PR on GitHub, after a card that always asks (without a PR it merges on this Mac).
  Undo opens a revert PR.
- **Collisions.** If someone else changed the same lines first, nothing is pushed: Needs you shows the
  files and who landed first. "Update from main" brings their changes in and has the session redo its own
  change on top; their lines stay as they are. Orb never picks a winner for you.

Teams need the [GitHub CLI](https://cli.github.com) installed and signed in once (`gh auth login`), and a
test command per repo in `/config` so Orb can check the work itself.

## Your Claude login and API keys

Orb uses your own Claude subscription through the unmodified Claude Code, signed in with Anthropic's
own flow. Orb refuses to start if `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, and stops any
session that reports an API key, so nothing is billed as API usage.

Anthropic's terms allow "an end user signing in to the unmodified Claude Code binary with their own
Claude subscription", but the Agent SDK docs also say third-party products shouldn't offer claude.ai
login without approval. Orb has no login of its own; you sign in to Claude Code yourself. Read
[Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) and
decide for yourself.

## What Orb can and can't touch

- Only folders you added in the setup, and the repos inside them.
- Never: `secrets/` folders, `.env` files, keys and credentials, `~/.ssh`, `~/.aws`. Searches over a folder
  that holds secrets are refused too.
- Each tool call that needs permission shows a card; you can switch a repo to Claude Code's auto mode
  from the header if you want fewer cards.
- The page only listens on `127.0.0.1` and needs its token. Local speech engines are called only from
  Orb's server.

## Local speech

Speech recognition is local by default: Parakeet, with Whisper as its fallback. Browser speech
recognition is a choice on a personal machine only, because Chrome sends your voice to Google to
transcribe it. Her voice comes from your system voices until you install Kokoro.

For fully local speech, install [VoiceMode](https://github.com/mbailey/voicemode)'s Whisper (speech
to text, port 2022) and Kokoro (voices, port 8880), then pick them in Settings → Open setup → Voice.
"Install Kokoro" there does the Kokoro part in one click.
Parakeet (faster speech to text) works when its library and model are present; see `src/orb/parakeet.py`.

## Settings and data

Everything lives in `~/.orb` (mode 0700): `settings.json` (your folders and choices), `sessions.json`,
the access token, timing logs. Environment overrides use `ORB_*` (for example `ORB_PORT`, `ORB_STATE`).

Optional extras for power users, in `~/.orb/settings.json`: `client_dirs` (folders only their own sessions
may touch), `skip_names` (folder names never opened), a notes `vault`, `brain` (claude.ai Brain
connectors), `connectors` (the other claude.ai connectors; off by default, sessions load none) and
`routines` (a panel for claude.ai scheduled agents). `brain` and `connectors` apply in the personal profile
only.

## Tasks: Vikunja or Jira

Home, the Tasks list, delegations and "Make it a task" read and write one task tracker. Set its address in
Settings → Tasks; tokens come only from the environment, never from the page or `settings.json`:

- **Vikunja:** `vikunja_url` (or `ORB_VIKUNJA_URL`) and `ORB_VIKUNJA_TOKEN`.
- **Jira Cloud:** `jira_url` (or `ORB_JIRA_URL`, e.g. `https://acme.atlassian.net`), `ORB_JIRA_EMAIL` and
  `ORB_JIRA_TOKEN` (an API token from id.atlassian.com). Orb lists issues assigned to you that aren't done;
  `ORB_JIRA_JQL` replaces that query. Jira wins when both addresses are set.

Orb started from Terminal takes them from that Terminal, for example `ORB_VIKUNJA_TOKEN=<your token> orb`.
For Orb started at login, export them and run the start-at-login command again; it stores them in the login
job's file (`~/Library/LaunchAgents/dev.orb.server.plist`, readable only by you) and restarts Orb:

```sh
read -rs ORB_VIKUNJA_TOKEN && export ORB_VIKUNJA_TOKEN   # paste the token, press Return (it isn't shown)
curl -fsSL https://raw.githubusercontent.com/kkuklewski/orb/main/deploy/install-launchd.sh | sh
```

Jira works the same with `ORB_JIRA_EMAIL` and `ORB_JIRA_TOKEN`. A later run keeps the tokens you don't export;
`export ORB_JIRA_TOKEN=` (empty) removes one.

A notes vault can map repos to projects in `projects/*.md` frontmatter: `vikunja_project: <id>` or
`jira_project: <KEY>`, next to `local: <repo path>`.

## When something goes wrong

| You see | Do |
| --- | --- |
| `command not found: uv` or `orb` | Quit Terminal and open it again. Still missing: run `uv tool update-shell`, then reopen. |
| "Orb is already running" | It runs at login or in another window: `orb open` opens its page. |
| "access token is out of date" / "Open the link Orb printed" | Orb restarted: run `orb open`. |
| Claude isn't signed in | Run the sign-in command the page shows, in Terminal. |
| "Refusing to start: ANTHROPIC_… is set" | Remove `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` from your shell setup (`~/.zshrc`), then reopen Terminal. |
| Tasks say the tracker is unreachable | Check the address in Settings → Tasks and that Orb was started with the token (see [Tasks](#tasks-vikunja-or-jira)). |

## Development

```sh
git clone https://github.com/kkuklewski/orb && cd orb
uv run orb                       # serve on 127.0.0.1:8765
uv run pytest                    # unit tests
scripts/check-public.sh          # no private names before a push
```

The page is moving to React + TypeScript + Vite in `web/` ([plan](docs/react-migration.md)); the new
page is the only one, at `/` (`/next/...` links redirect). To work on it (Node 22.12+):

```sh
ORB_DEV_ORIGIN=http://localhost:5173 uv run orb     # the server, accepting the dev page
cd web && npm ci && npm run dev                     # open http://localhost:5173/static/app/#t=<token>
npm run build                                       # writes src/orb/static/app; commit it (CI checks)
```

`CLAUDE.md` explains how the parts fit together.

## License

MIT, see `LICENSE`.
