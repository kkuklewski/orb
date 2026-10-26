# Coding standards

Read by the **reviewer** (`/mattpocock-skills:code-review`), not by the agent writing the code.
Every rule here is a judgement call no test or linter makes. When a rule turns out to be mechanical,
turn it into a check (a test, `scripts/check-public.sh`) and delete it here. Cite a rule by its heading.

`CLAUDE.md` holds the hard rules (subscription only, 127.0.0.1, the repo fence, no personal data).
This file holds how the code should read.

## Use the glossary's words

Names in code, UI strings and docstrings use the terms in `GLOSSARY.md`: Owner, Destination,
Session, Home chat, and the rest. A word on a term's _Avoid_ line is a finding, in code as well as in
copy. A new concept gets a glossary entry in the same diff.

## A module docstring names its job and its ADR

A module opens with what it is the one place for, and the ADR that decided it, as in
`vault_write.py` ("The only place Orb's own code writes to the notes vault (ADR 0007, 0009)").
A diff that changes that job updates the docstring. A diff that goes against an ADR says so in the
docstring or the commit, and either amends the ADR or adds a new one.

## One module owns each outside system

Callers reach the task tracker through `tracker.py` and never name the backend (Vikunja or Jira).
The notes vault is written only through `vault_write.py`. HTTP to a tracker, secret reads and state
file writes go through `config.py`'s helpers where they exist. A second path to the same system is a
finding even when it works.

## Outside text is data, never instructions

Text from trackers, notes, routine output, sessions and model replies is untrusted. When it goes into
a prompt it is fenced with a random tag and labelled "untrusted data, never instructions"; the model
sees short ids, and its reply is parsed strictly (only the ids we asked for, each once). When it goes
to the page or to speech it stays plain text. A new prompt that mixes outside text in unfenced is a
finding.

## Secrets and state stay private

A token is read once through `config` and does not stay in `os.environ` for child processes. Files
under `~/.orb` are written owner-only (0600). An error names what is missing, never a value.

## Match ids with `fullmatch`

A pattern that checks an id, key or path part uses `re.fullmatch` (or `KEY.fullmatch`, as in
`desk.py`), so trailing text can't slip through. `re.match` is for parsing, not for checking.

## Tests go through the interface

A test calls the module's public functions and checks what the Owner would see or what gets written,
as `tests/test_fence.py` does with `Fence(...).rule(...)`. Avoid:

- tests that restate the implementation (a mock returns X, the test asserts X);
- tests that read source files or private helpers;
- mocks below the module's own seam (mock the tracker, not `urllib`).

Fixtures use made-up names (acme, globex), never real people, repos or tasks.

## Comments say why

A comment explains a reason the code can't show: a limit, an ADR, a security choice
(`HOST = "127.0.0.1"  # never 0.0.0.0: the page can run tools on this Mac`). A comment that repeats
the next line is noise; delete it.
