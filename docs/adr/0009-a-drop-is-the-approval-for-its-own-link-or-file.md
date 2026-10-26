# A drop is the approval for its own link or file, and it runs in the background

The first drop zone sent every drop to the Home chat and moved the page there, because each route needed approval
cards. A YouTube link then took two cards (run the fetch script, commit and push the transcript) for something the
owner had already asked for by dropping it. Dropping is the request and the approval: what the drop names may happen
without asking, in the background, and nothing else may.

## Consequences

- The page stays on Home. The drop zone lists the last few drops with their state (Working…, Needs you, Saved, the
  reason it failed) and an Open / Open note button. A session's drop ends with its first turn (`drop_done`: saved or
  answered, or the error it hit); the legend lists only the routes this install can take.
- A route is either a **job** that Orb's own code runs (no model, no card) or a **request** for a new background
  session in the notes folder.
- YouTube is a job: Orb runs the vault's own fetch script (settings `transcript_script`, vault-relative; the webhook
  token stays in the owner's config and Orb never reads it), writes a **new** file `<transcripts_folder>/<day>-<id>.md`
  (default `scrapers/Transcripts`, never over an existing one), commits **only that path** with hooks, fsmonitor and
  signing off, and pushes without force. A failed commit unstages the file; a failed push keeps the commit and says so;
  Orb never pulls, rebases or stashes the owner's work. This is the Drop item on ADR 0007's allowlist and the one place
  Orb commits. Without a script set, a YouTube link is an ordinary link.
- That job runs without a card, so it runs nothing a session could have changed unseen: the script must be a plain file
  inside the vault (no symlink, no `..`) that git tracks **unchanged from HEAD**, and Orb's git calls refuse to run
  while the vault's own git config sets a key that runs a program or redirects the push (`vault_write.UNSAFE_GIT`:
  fsmonitor, filters, includes, credential helpers, ssh command, url rewrites, …). The remaining trust is the vault's
  own history: a session can change the script only with a commit the owner allowed on a card.
- Link and file routes start a session with a **drop grant** (`intake.DropGrant`, the same `covers` shape as ADR 0005's
  grant): fetching that exact URL, reading that exact dropped file, and on the "saved to Brain" route only, one Brain
  Capture `kind="link"` whose `url` is that URL; the summary route saves nothing without a card. The fence
  and vault rules run first; any other call raises its card, which reaches Needs you like any background session's.
- The grant lives on that one session and is never stored or carried over.
