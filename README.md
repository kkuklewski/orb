# Orb

Talk to Claude by voice, in the code repos you choose. Orb is a small local web app: pick a repo,
press Talk, and talk. Claude answers out loud with a short summary and shows the full answer in
the chat. Under the hood it runs [Claude Code](https://code.claude.com) through the Claude Agent SDK,
so it can read your code, run commands and make changes. Every change asks you first.

Powered by Claude. Orb is not made by or affiliated with Anthropic.

## What you need

- A Mac (Orb is built and tested on macOS; Linux may work, Windows is untested).
- A **Claude Pro or Max** subscription.
- Chrome or Safari.
- [uv](https://docs.astral.sh/uv/) to install it.

## Install and start

```sh
uv tool install git+https://github.com/kkuklewski/orb
orb
```

`orb` prints a link like `http://127.0.0.1:8765/#t=…`. Open it; the first time, a short setup runs:

1. **Sign in to Claude.** Orb shows the command to run in Terminal (`claude auth login`). You sign in
   in Anthropic's own browser window. Orb never sees, stores or forwards your login. It only checks
   that Claude Code is signed in with a subscription, and which plan.
2. **Choose the folders Orb may open.** Orb lists the git repos inside them. A conversation stays in
   its own repo; touching another repo needs your OK.
3. **Voice.** Browser speech works right away. For fully local speech, see [Local speech](#local-speech).
4. **How it keeps you in control.** Then you're in.

The link carries a private access token. The page remembers it, so later `http://127.0.0.1:8765/`
is enough in the same browser. To run Orb at login, see `deploy/install-launchd.sh`.

## Your Claude login and API keys

Orb uses your own Claude subscription through the unmodified Claude Code, signed in with Anthropic's
own flow. Orb refuses to start if `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, and stops any
session that reports an API key, so nothing is billed as API usage.

Anthropic's terms allow "an end user signing in to the unmodified Claude Code binary with their own
Claude subscription", but the Agent SDK docs also say third-party products shouldn't offer claude.ai
login without approval. Orb has no login of its own; you sign in to Claude Code yourself. Read
[Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) and
decide for yourself.

## Using it

| Action | How |
| --- | --- |
| Pick a repo | "+ New" lists every repo in your folders. Pin the ones you use. |
| Talk | Click Talk or press Space. Each pause sends a request; short pauses mid-sentence are fine. |
| Type | The box at the bottom. `/` opens commands: your Claude Code skills, `/clear`, `/model`, `/config`. |
| Approve a tool | Allow / Deny on the card, or say "yes" / "no" (with headphones). |
| Stop her | Esc or ■. With headphones you can just talk over her. |
| Hear the whole answer | "Read all" under an answer. |
| Settings | Voice, approvals and model for new folders, vocabulary, dark or light, and "Open setup" to change your folders. |

## What Orb can and can't touch

- Only folders you added in the setup, and the repos inside them.
- Never: `secrets/` folders, `.env` files, keys and credentials, `~/.ssh`, `~/.aws`. Searches over a folder
  that holds secrets are refused too.
- Each tool call that needs permission shows a card; you can switch a repo to Claude Code's auto mode
  from the header if you want fewer cards.
- The page only listens on `127.0.0.1` and needs its token. Local speech engines are called only from
  Orb's server.

## Local speech

Browser speech is the default: Chrome sends your voice to Google to transcribe it; Safari can
transcribe on your Mac. Her voice comes from your system voices.

For better, fully local speech, install [VoiceMode](https://github.com/mbailey/voicemode)'s Whisper (speech
to text, port 2022) and Kokoro (voices, port 8880), then pick them in Settings → Open setup → Voice.
Parakeet (faster speech to text) works when its library and model are present; see `src/orb/parakeet.py`.

## Settings and data

Everything lives in `~/.orb` (mode 0700): `settings.json` (your folders and choices), `sessions.json`,
the access token, timing logs. Environment overrides use `ORB_*` (for example `ORB_PORT`, `ORB_STATE`).

Optional extras for power users, in `~/.orb/settings.json`: `client_dirs` (folders only their own sessions
may touch), `skip_names` (folder names never opened), a notes `vault`, `brain` (claude.ai Brain
connectors) and `routines` (a panel for claude.ai scheduled agents).

## Development

```sh
git clone https://github.com/kkuklewski/orb && cd orb
uv run orb                       # serve on 127.0.0.1:8765
uv run pytest                    # unit tests
scripts/check-public.sh          # no private names before a push
```

`CLAUDE.md` explains how the parts fit together.

## License

MIT, see `LICENSE`.
