# Issue tracker: Vikunja

Issues and specs for this repo live as tasks in the self-hosted Vikunja project **`orb`** (project id `73`). GitHub
Issues are not used. Use the `vikunja` MCP server tools (`mcp__vikunja__*`) for every operation; don't call the
HTTP API directly and never read or print the Vikunja token.

## Conventions

- **Create an issue**: `tasks_create` with `projectId: 73`, `title`, `description` (Markdown is fine). Its `labels`
  field is ignored by Vikunja: add each label afterwards with `task_labels_add`.
- **Read an issue**: `tasks_get` with the task id, then `task_comments_list` for the discussion.
- **List issues**: `tasks_list` with `projectId: 73` and `filter: "done = false"`; add `&& labels in <label id>` to
  filter by label.
- **Make an issue a sub-issue of a parent**: `task_relations_add` with `taskId: <parent>`, `otherTaskId: <child>`,
  `relationKind: "subtask"`.
- **Comment on an issue**: `task_comments_add`.
- **Apply / remove labels**: labels are account-wide (shared by every project), so look up the id with `labels_list`
  (`search`), then `task_labels_add` / `task_labels_remove`. Create a missing label with `labels_create` only when a
  skill needs it.
- **Close**: `task_comments_add` with the reason, then `tasks_update` with `done: true`.
- **References**: write tasks as `#<task id>` (Vikunja's task id, not the per-project index).

## Pull requests as a triage surface

**PRs as a request surface: no.** PRs live on GitHub, issues in Vikunja; `/triage` does not read PRs.

## When a skill says "publish to the issue tracker"

Create a Vikunja task in project `73`.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single task with **child** tasks as tickets.

- **Map**: a task in project `73` labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog in its
  description.
- **Child ticket**: a task linked to the map with a `subtask` relation (map -> child). Labels: `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving user.
- **Blocking**: `task_relations_add` with `taskId: <child>`, `otherTaskId: <blocker>`, `relationKind: "blocked"`
  (Vikunja adds the reverse `blocking` edge). A ticket is unblocked when every blocker is done.
- **Frontier query**: `tasks_get` on the map, take its subtasks, drop any that is done, has an open `blocked`
  relation, or has an assignee; the lowest task id wins.
- **Claim**: `task_assignees_add` (find the user id with `users_search`), the session's first write.
- **Resolve**: `task_comments_add` with the answer, `tasks_update` with `done: true`, then append a context pointer
  (gist + `#<id>`) to the map's Decisions-so-far with `tasks_update` on the map's description.
