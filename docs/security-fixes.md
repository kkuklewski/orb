# Security fixes (audit, 2026-10)

A read-only audit of the whole app (server and page, approvals and fence, delegation, intake and vault) found
three high, four medium and a handful of low issues. This is the plan and its progress; each step lands with
its tests. The threat model is the one in CLAUDE.md: a hostile or prompt-injected model, a malicious repo in
the roots, a malicious website in the owner's browser, another local user.

## High

1. **Repo settings skip the cards.** `FolderSession._options` sets no `setting_sources`, so Claude Code loads
   the user's, the repo's and the local settings. Their allow rules approve a call before `can_use_tool`; a
   repo's own `.claude/settings.json` can also add hooks (they run at session start) and MCP servers.
   - [x] Per-repo `/config` switch **Trust repo settings** (`trustSettings`, off by default, never on for a
     delegation worktree). Off: `setting_sources=["user"]`, and Orb appends the repo's `CLAUDE.md` files
     itself (cwd and its parents, as Claude Code would, plus the repo's `.claude/rules`; symlinks skipped).
     On: user, project and local, as before. A change reconnects the repo's idle sessions (`trust.py`).
   - [x] The fence cards (with a warning) any write to what changes which code runs without a card, in any
     repo: `.claude/settings*.json`, `.claude/{hooks,skills,commands,agents,plugins}/`, `.mcp.json`,
     `.git/hooks/`, `.git/config`. A fence "ask" always raises a card, so a grant no longer covers them;
     `CLAUDE.md` and `.claude/rules` stay covered (text, they approve nothing).
2. **A grant runs model-written code without a card.** The grant covers edits in the worktree and the
   declared test/build commands, and those commands run the edited files (`package.json` scripts,
   `conftest.py`). Orb also runs the test itself after each turn, with its full environment.
   - [x] `sandbox.py`: a macOS `sandbox-exec` profile for declared commands. Writes only in the worktree, its
     package caches and the temp folders; no reads of the home folder except the toolchains (a fixed list, the
     PATH folders in the home folder and the install folders their programs link into, plus settings
     `sandbox_read`) and the repo's git folder; no keychain, ssh agent or Docker socket; network on. Package
     caches go to a per-worktree temp folder (never inside the worktree, so `git add -A` can't pick them up).
     Only the basic environment variables (no Orb, tracker, proxy or token variables); bash without rc files.
   - [x] A covered declared command runs through the sandbox (`Grant.safe_input`), and so does Orb's own
     test run. Without `sandbox-exec` (not macOS) a declared command is no longer covered: it gets a card,
     and Orb's own test run is skipped (`tests: "skipped"`, no push). The Delegate card says so.
   - [x] A timed-out run kills its whole process group.
3. **`~/.ssh` is only carded.** `check_path` denies `.aws` but not `.ssh`; `is_secret_name` misses
   `id_ecdsa`, `id_dsa`, `.netrc`, the GitHub CLI's `hosts.yml`.
   - [x] Deny `~/.ssh` and `~/.gnupg` like `~/.aws`, and widen the secret names (`id_ecdsa`, `id_dsa`, `.netrc`,
     `.git-credentials`, `.pgpass`; in the home folder gh's `hosts.yml`, `.npmrc`, `.pypirc`, Docker and kube config).

## Medium

4. [x] **CSP skipped on raw pages.** `/static/index.html` and `/static/app/index.html` are served without the
   page's headers. HTML under `/static` is refused (404); every response gets `nosniff`, `X-Frame-Options` and,
   without its own CSP, `frame-ancestors 'none'` (the `Guard` middleware in `server.py`).
5. [x] **Fake cards in model output.** DOMPurify runs with defaults (forms, buttons, `class`, `id` survive)
   and the CSP has no `form-action`. Rendered markdown (React page and `/old`) uses its own purifier: no form
   elements, `style` or `dialog`; no `id`, `name`, `style` or `form*` attributes; `class` only as a code block's
   `language-*`; a checkbox stays only disabled (task lists). The CSP adds `form-action 'none'`.
6. [x] **Tracker tokens reach every session.** `ORB_VIKUNJA_TOKEN` / `ORB_JIRA_*` stay in `os.environ`, which
   the SDK passes to Claude Code and every Bash call. `config` reads them once at import and drops them from the
   environment; `config.secret(name)` serves them to the tracker clients.
7. [x] **Page token never rotates.** Another local user who binds the port while Orb is stopped can read it
   from the page's storage. A new token on every start (`config.token()`, kept in memory, the file rewritten
   0600 for the spikes), so a stored token or a link from an earlier run gets 4403 ("open the new link"). The page
   keeps it in localStorage, not sessionStorage: the installed home-screen app opens without the `#t=` link, and a
   token that dies at the next start is worth nothing to a port squatter.

## Low

8. [x] Host header check (DNS rebinding): only `127.0.0.1`, `localhost`, `[::1]`, the names in `ORB_HOSTS` and
   `*.ts.net` (Tailscale serve, the iPad route); anything else gets 421 (a WebSocket is closed).
9. [x] Billing guard: also blank and refuse `ANTHROPIC_BASE_URL` (it would receive the login's token).
10. [x] Apply and push pin the commit the check ran on (`checked`). A push of a branch that moved since is refused
    ("re-run the check"); Apply of one checks it again and applies once it is Ready. A branch that moves while
    the tests run fails the check.
11. [x] Vault push: push only when the new commit is the only one ahead of upstream; otherwise leave it for
    the owner ("other unpushed commits are in your vault").
12. [x] YouTube id patterns use `fullmatch` (a trailing newline passed `$`).
13. [x] Orb's own vault reads skip symlinks that resolve outside the vault (notes, the rubric, `projects/*.md`).
14. [x] Tracker HTTP calls don't follow redirects (the `Authorization` header would go along): `config.urlopen`.
15. [x] State files Orb writes are 0600 (`sessions.json`, `vocabulary.txt`, `timing.jsonl`, `needs.json`, …):
    `config.write_private` / `append_private`.

## Follow-up

- Apply could warn when the diff touches a file `trust.runs_code` names: a sandboxed command can write
  `.claude/settings.json` in the worktree (no card, it's inside the sandbox's writes), and a repo with
  `trustSettings` on would load it after Apply. The diff shows it today; a warning line on the Apply card would
  make it hard to miss.

## Work machine (profile)

For an install on an employer's machine. `settings["profile"]`: `work` for a new install, `personal` for an
install from before profiles (it keeps working as it did). Settings → This Mac and the onboarding's first
step switch it; a switch rebuilds every session's fence and reconnects it when idle.

- [x] **No connectors by default.** Sessions get `ENABLE_CLAUDEAI_MCP_SERVERS=false` unless `brain` or the new
  `connectors` setting is on; work keeps both off. With `brain` alone, a PreToolUse hook on `mcp__claude_ai_.*`
  denies every other connector's tool (a hook, so the user's own allow rules can't let one past).
- [x] **Voice stays on the Mac.** New installs hear through Parakeet (Whisper fallback). Browser speech
  recognition (Chrome sends the audio to Google) is labelled so and refused in work (a saved "browser" reads
  as Parakeet there).
- [x] **Clean client repos.** Work fences every other repo like a client folder: denied, the vault session reads
  with a card; `in_client()` is true, so a delegation never pushes without the Needs you card.
- [x] **Localhost only.** Work answers no `*.ts.net` Host (Tailscale serve is a personal route).

## Not changing

- `auto` permission mode stays: only the owner can set it, per repo, and the fence still applies.
- Local speech engines on plain localhost HTTP: a port squatter needs a second local account; noted only.
