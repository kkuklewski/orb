# Jira Cloud can stand in for Vikunja

Orb's tasks (Home's queue, the Tasks list, delegations, "Make it a task") came only from Vikunja. Someone without a
Vikunja server, a team on Jira, had no task source at all. Orb is public, so the tracker can't be the author's own.

Decision: one tracker at a time, chosen by configuration. `tracker.py` is the only module callers use; it passes each call
to `vikunja.py` or `jira.py`, which give the same task shape and the same writes (done / reopen, priority, due date,
create, delete). Jira is used when a Jira address is set (`jira_url` or `ORB_JIRA_URL`), else Vikunja.

## Consequences

- Jira Cloud only, REST v3, Basic auth with `ORB_JIRA_EMAIL` and an API token in `ORB_JIRA_TOKEN`. Like the Vikunja
  token, the credentials are read only from the environment: never stored in settings, never sent to the page.
- Open tasks are `assignee = currentUser() AND statusCategory != Done` (override: `ORB_JIRA_JQL`). A task's id is the
  issue's numeric id, so ids stay ints everywhere; its title starts with the issue key ("ACME-12 Fix login").
- Done and reopen are workflow transitions, picked by status category (done / new, else in progress). A workflow with no
  such step is an error the owner sees, not a silent no-op. Priorities map to Jira's five names
  by meaning (1 Low, 2 Medium, 3 High, 4-5 Highest; Lowest reads as 1), so 5 reads back as 4. 0 clears the priority,
  as unset does in Vikunja; a project that requires one refuses that, and the owner sees why.
- Repo -> project: the vault's `projects/*.md` frontmatter `jira_project` (key or id), as `vikunja_project` for Vikunja.
  "Make it a task" with no mapped repo goes to the project named by `tasks_inbox` (name or key).
- Internal names stay as they were (`vikunja:<id>` keys, the item source `vikunja`): they name Orb's Tasks source, not
  the product. The page shows the tracker's name from `features.tracker`.
- The claim (#866) is the same rule on both: Vikunja adds the owner as one more assignee by user id (never the bulk
  call); Jira has one assignee, so free means unassigned and is checked before the assign, which overwrites.
- Not done: Jira Server / Data Center, OAuth, more than one tracker at once.
