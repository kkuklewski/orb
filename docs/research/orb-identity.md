# Who am I: Orb's identity in the tracker and in git (research, map 861 / ticket 865)

Facts only, 2026-10-28. Code read on main 70c4890; live checks counted, no names. Made-up people: acme-dev, globex-dev.

## Summary

| Where | "Me" today | Cheap way to know it, no new setting | Who assigned / when |
| --- | --- | --- | --- |
| Vikunja | nobody: Orb never asks | `GET /user` with `ORB_VIKUNJA_TOKEN` → `id`, `username` | only who is assigned (no doer, no time in the API) |
| Jira | `currentUser()` inside the JQL only | `GET /rest/api/3/myself` → `accountId` | issue changelog: `author` + `created` per assignee change |
| git commits | the repo's / global `user.name` + `user.email` | `git config user.name` / `user.email` in the repo | n/a |
| PR author | the `gh` account | `gh api user --jq .login` | n/a |

## Vikunja

- **Me:** `GET /api/v1/user` (handler `UserShow`) works with an API token (Bearer `tk_…`) and returns `id`, `username`,
  `name`, `email`, `created`, `updated` plus settings fields. Token permission: group `other`, key `user`
  (`pkg/models/api_routes.go`; derived from source, check a live server with `GET /api/v1/routes`).
- **Orb today:** `vikunja.py` never asks who it is. `open_tasks` reads every open task (`filter: done = false`) of every
  project the token can see, and keeps no assignee field; `task()` drops `assignees` too. So Home and Delegate can't tell
  a task assigned to acme-dev from one assigned to globex-dev or to nobody.
- **Assignees on a task:** `task.assignees` is a list of user objects (`id`, `name`, `username`, `created`,
  `updated`); `GET /tasks/{id}/assignees` returns the same. Many assignees per task (a join table).
- **Assign:** `PUT /api/v1/tasks/{id}/assignees` with `{"user_id": N}`: the numeric id, never the username. 201 with
  `{"user_id", "created"}` (the live call on this ticket returned a zero `created`). Same user twice → HTTP 400, error
  4021 "already assigned". Unassign: `DELETE /tasks/{id}/assignees/{userId}`. `POST …/assignees/bulk` replaces the whole
  set (unsafe for a claim). Token permissions: `tasks_assignees` `create` / `read_all` / `delete`.
- **No lock:** no ETag, If-Match or version on assignees; "assign only if nobody is" is read-then-write and can race.
  Vikunja's own `_update` path (whole task resent) is not used for assignees.
- **Who assigned, when:** the API doesn't say. The assignee row's `created` is not returned on reads. The doer exists
  only in a `task.assigned` notification (sent to subscribers other than the doer, each sees only their own), in
  webhooks (`task.assignee.created`, if configured) and in the server's audit log (off by default, a file, no API).

## Jira

- **Me:** `GET /rest/api/3/myself` (Basic auth: email + API token, the same `ORB_JIRA_EMAIL` + `ORB_JIRA_TOKEN`
  `jira.py` uses) returns `accountId`, `displayName`, `emailAddress` (may be null by privacy settings), `active`,
  `timeZone`. `accountId` is the only stable id.
- **Orb today:** `jira.py` never calls `/myself`; "me" appears only in the default JQL
  `assignee = currentUser() AND statusCategory != Done` (`JIRA_JQL` can override it). So Jira's open list is already
  "mine" while Vikunja's is "everyone's": a parity gap. `_row` keeps no assignee field.
- **Assign:** `PUT /rest/api/3/issue/{key}/assignee` with `{"accountId": "…"}` → 204. One assignee per issue.
  `accountId: null` unassigns, `"-1"` sets the project default. Needs Browse Projects + Assign Issues; the target must be
  an Assignable User (`GET /rest/api/3/user/assignable/search?accountId=&issueKey=` checks).
- **No lock:** no If-Match / ETag / version on the edit or assignee endpoints; read-then-write only. A later read of the
  changelog shows who actually holds it.
- **Who assigned, when:** `GET /rest/api/3/issue/{key}/changelog` (oldest first, paginated) or `?expand=changelog`:
  each entry has `author.accountId`, `created`, and items with `field == "assignee"`, `from` / `to` accountIds.

## git and GitHub

- Orb sets no git identity of its own except on the snapshot commit: `worktree.py` `_ORB` (`Orb <orb@localhost>`)
  is used only for "Orb snapshot: uncommitted changes when … was delegated".
- Every other commit takes the repo's git config: a delegated session's `git commit` in its worktree, Apply's
  `commit-tree` (`worktree._land`) and Undo's revert. So the commit author is the owner's `user.name`/`user.email`
  (repo-local if set, else global; on this machine: no repo-local value, global name and email set).
- Two people's Orbs are told apart in git by their own git config, nothing Orb adds. Two machines of the same owner
  look the same in git.
- The PR is made by `gh pr create` (`delegation.py`), so its author is the account `gh` is logged in to
  (`gh auth status`: one active account, scopes include `repo`), not git's `user.name`. `GH_TOKEN` / `GITHUB_TOKEN` in the environment would override the keyring account.
  `gh api user --jq .login` names that account. Not verified by creating a PR.

## What Orb could read, per machine, without a new setting

- Tracker: one call at start (or on first tracker use) to `/user` (Vikunja) or `/myself` (Jira), cached in memory:
  the id to assign with and compare against, plus a display name for cards.
- Git: `git config user.name` in the repo (what commits will say); `gh api user --jq .login` (what the PR will say).
- Host: `socket.gethostname()` if a record should say which machine; nothing in Orb names the machine today.

## Differences that matter for claiming (866)

- Vikunja allows several assignees, Jira one: "assigned to someone else" means "any assignee ≠ me" on Vikunja and "the
  assignee ≠ me" on Jira.
- Neither tracker has an atomic "claim if free"; a claim is read, assign, then re-read.
- Same owner on two machines: same tracker user (same token owner), so the tracker can't tell the machines apart; only
  a comment or the PR body naming the host could.
- Only Jira can show who made a claim and when; on Vikunja Orb would have to write that itself (e.g. a comment).

Sources: Vikunja v2.5.0 source (`pkg/routes/api/v1/user_show.go`, `pkg/models/task_assignees.go`,
`pkg/models/api_routes.go`, `pkg/models/notifications.go`), vikunja.io docs (api-v2, errors); Atlassian Jira Cloud
REST v3 OpenAPI spec; local `gh auth status`.
