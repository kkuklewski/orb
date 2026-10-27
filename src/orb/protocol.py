"""The WebSocket protocol between Orb's server and its page: one model per message, both ways.

This file is the single source of truth. `uv run orb-protocol` writes its JSON Schema to
web/src/protocol.schema.json, and `npm run gen:protocol` (in web/) turns that into
web/src/protocol.gen.ts, so the page's TypeScript sees every event as a discriminated union on
`type`. CI regenerates both and fails on any difference; tests/test_protocol.py checks that every
event the server code builds, and every message handle() reads, is described here with its fields.

Nested payloads the React page doesn't use yet stay loosely typed (dict / Any); tighten them as
their screens move over.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

Json = dict[str, Any]


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Event(_Msg):
    # Added by FolderSession.emit to everything a session sends, and to replayed history.
    folder: str | None = None
    session: str | None = None
    replay: bool | None = None


# -- shared shapes --------------------------------------------------------------------------------

class SessionItem(_Msg):
    key: str
    label: str | None = None
    created: float | None = None
    last_used: float | None = None
    empty: bool
    archived: bool = False
    status: str
    live: bool
    mcp_failed: int = 0
    opus: int = 0
    ask: str | None = None  # one-line summary of the open approval card, e.g. Bash(psql ...)


class FolderItem(_Msg):
    path: str
    label: str
    rel: str
    remote: str | None = None
    branch: str | None = None
    last_used: float | None = None
    status: str = "idle"
    pinned: bool = False
    mcp_failed: int = 0
    live: bool = False
    has_session: bool = False
    sessions: list[SessionItem] = []


class Features(_Msg):
    """What this install has turned on, and how Claude Code is signed in (plan only)."""
    roots: list[str]
    vault: str
    brain: bool
    routines: bool
    onboarded: bool
    stt: Literal["browser", "parakeet", "whisper"]
    tts: Literal["browser", "kokoro"]
    plan: str | None = None
    tracker: str = "Vikunja"  # the task tracker's name, for the page's words (ADR 0010)
    profile: Literal["work", "personal"] = "work"  # settings.py: work keeps connectors, browser speech and other repos off
    drops: list[str] = []  # what Home's drop zone can do here, its route labels (intake.labels)


class AuthStatus(_Msg):
    installed: bool
    loggedIn: bool
    subscription: str | None = None
    method: str | None = None
    subscriptionLogin: bool = False
    error: str | None = None


class RootInfo(_Msg):
    path: str
    exists: bool
    repos: list[str]


class Suggestion(_Msg):
    path: str
    repos: int


class Voice(_Msg):
    id: str
    name: str
    desc: str
    grade: str | None = None


class BrowseEntry(_Msg):
    name: str
    path: str
    repo: bool


# -- server -> page -------------------------------------------------------------------------------

class HelloEvent(_Event, Features):
    type: Literal["hello"]
    build: str
    folders: list[FolderItem]
    services: dict[str, bool]
    rate_limit: Json | None = None


class FeaturesEvent(_Event, Features):
    type: Literal["features"]


class FoldersEvent(_Event):
    type: Literal["folders"]
    items: list[FolderItem]


class VaultInfo(_Msg):
    """The notes folder as the setup shows it: where, and what Orb found in it."""
    path: str
    exists: bool
    notes: int
    open_tasks: int


class KokoroJob(_Msg):
    """The one-click Kokoro setup's progress (kokoro_setup.py)."""
    step: str
    running: bool
    error: str | None = None


class KokoroInstall(_Msg):
    """How far VoiceMode's Kokoro is set up on this Mac, for the setup's Kokoro card (running is `speech.kokoro`)."""
    voicemode: bool  # the `voicemode` command
    installed: bool  # the Kokoro service's files
    autostart: bool  # starts at login
    exposed: bool  # a start script listens on every interface, not only this Mac
    job: KokoroJob | None = None


class SetupStatusEvent(_Event):
    type: Literal["setup_status"]
    auth: AuthStatus
    login_cmd: str
    roots: list[RootInfo]
    suggested: list[Suggestion]
    home: str
    speech: dict[str, bool]
    voices: list[Voice]
    kokoro_install: KokoroInstall | None = None  # None: not a Mac
    values: Json
    vault: VaultInfo | None = None


class BrowseEvent(_Event):
    type: Literal["browse"]
    path: str
    home: str
    parent: str | None
    repo: bool
    entries: list[BrowseEntry]
    truncated: bool


class PickedEvent(_Event):
    type: Literal["picked"]
    path: str | None = None
    error: str | None = None
    cancelled: bool | None = None


class VoiceSampleEvent(_Event):
    type: Literal["voice_sample"]
    voice: str
    mime: str | None = None
    data: str | None = None
    error: str | None = None


class SettingsEvent(_Event):
    type: Literal["settings"]
    values: Json
    voices: list[str]
    recommended: list[Voice]
    vocabulary: str
    vocab_seed: list[str]
    whisper_prompt: str
    vault: str
    port: int
    host: str


class ErrorEvent(_Event):
    type: Literal["error"]
    text: str


class NoticeEvent(_Event):
    type: Literal["notice"]
    text: str
    level: Literal["ok", "warn", "error"] | None = None


class OpenedEvent(_Event):
    type: Literal["opened"]
    label: str
    branch: str | None
    rel: str
    session_id: str | None
    live: bool
    busy: bool
    speech_gen: int
    mode: str
    model: str
    info: SessionInfo
    tasks: list[TaskInfo]


class HistoryEvent(_Event):
    type: Literal["history"]
    events: list[Json]


class StateEvent(_Event):
    type: Literal["state"]
    value: str
    busy: bool


class ContextUsage(_Msg):
    """Tokens of the last main-thread call and the model's window."""
    used: int
    window: int


class SessionInfo(BaseModel):
    """What agent.py keeps in FolderSession.info (from Claude Code's init message, then updated)."""
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    front: str | None = None
    permissionMode: str | None = None
    apiKeySource: str | None = None
    version: str | None = None
    mcp_failed: int | None = None
    mcp_total: int | None = None
    context: ContextUsage | None = None


class SessionInfoEvent(_Event, SessionInfo):
    model_config = ConfigDict(extra="allow")
    type: Literal["session_info"]
    session_id: str | None = None


class ContextEvent(_Event, ContextUsage):
    type: Literal["context"]


class TaskInfo(_Msg):
    """One background task (an opus-coder run or a background shell), as agent.py keeps it."""
    task_id: str
    description: str | None = None
    coder: bool = False
    tool_use_id: str | None = None
    status: str
    summary: str | None = None


class TaskEvent(_Event, TaskInfo):
    type: Literal["task"]


class CommandItem(_Msg):
    """One entry of the slash menu (slash.merge): the dashboard's own first, then Claude Code's."""
    name: str
    description: str = ""
    argumentHint: str = ""
    local: bool = False


class CommandsEvent(_Event):
    type: Literal["commands"]
    items: list[CommandItem]


class McpServer(_Msg):
    name: str | None
    status: str | None
    tools: int | None = None
    error: str | None = None


class McpEvent(_Event):
    type: Literal["mcp"]
    servers: list[McpServer]
    open: bool | None = None


class UsageWindow(BaseModel):
    """One plan window from the SDK's rate-limit info (unifiedWindows)."""
    model_config = ConfigDict(extra="allow")
    utilization: float | None = None
    resetsAt: float | None = None


class RateLimitEvent(_Event):
    type: Literal["rate_limit"]
    status: str | None = None
    windows: dict[str, UsageWindow] | None = None
    overage: Any = None


class RoutineRun(_Msg):
    id: str
    at: float | None = None
    ended: float | None = None
    outcome: Literal["ok", "failed", "waiting", "running", "stuck"] | None = None
    summary: str = ""
    detail: str = ""  # the run's whole text (summary is its start); untrusted text, shown as plain text
    url: str = ""


class StreakRun(_Msg):
    """One counted run of a failure streak: its start and its checked claude.ai link."""
    at: float | None = None
    url: str


class RoutineStreak(_Msg):
    """A failure streak (routines.streak, GLOSSARY: Failure streak)."""
    count: int  # consecutive failed or judged-broken runs, newest first (at least routines.STREAK)
    since: float | None = None  # the start of the oldest counted run
    runs: list[StreakRun] = []  # the counted runs with a checked link, newest first (a Repair task's description)


class RoutineRepair(_Msg):
    """The routine's open Repair task (GLOSSARY: Repair task), as the last re-read in the tracker found it."""
    task: int
    url: str | None = None  # None until a check read it (after a restart, or while the tracker can't be read)


class RoutineItem(_Msg):
    """One row of the Routines panel (routines.item)."""
    id: str
    name: str
    enabled: bool
    repo: str = ""  # the git repository it runs against, "owner/name" ("" = none)
    cron: str = ""
    next_run_at: float | None = None  # None while the routine is past it (missed_at)
    missed_at: float | None = None  # the run time it missed, for "missed 06:00"
    last: RoutineRun | None = None
    needs: Literal["failed", "waiting", "stuck", "missed", "broken", "action"] | None = None  # broken/action: judged from an ok run
    new: bool = False
    worth: Literal["read", "skip"] | None = None  # Haiku's verdict on the last run; None = not judged
    why: str = ""  # its reason, in a few words (plain text: it was written from untrusted text)
    notify: Literal["always", "never"] | None = None  # your override for this routine's runs
    quiet: bool = False  # an ok run that won't notify (judged nothing to report, or you said never)
    loud: bool = False  # an unseen ok run that notifies
    state: Literal["failed", "stuck", "missed", "needs you", "worth reading", "nothing to report", "off"]  # the line's one word
    urgent: bool = False  # failed / waiting / stuck, or a judged problem with a deadline within a week or a security risk
    resolved: bool = False  # you marked the last run's judged problem resolved; the next run is judged afresh
    security: bool = False  # its judged problem is a security risk: its Needs you row is pinned (docs/adr/0012)
    streak: RoutineStreak | None = None  # a failure streak: its Needs you row offers Make it a task first
    repair: RoutineRepair | None = None  # its open Repair task: no second one is offered while it is open


class RoutinesEvent(_Event):
    type: Literal["routines"]
    items: list[RoutineItem]
    checked_at: float | None
    checking: bool
    error: str | None
    needs: int
    new: int
    read: int  # unread runs worth reading (judged so, or set to always)


class BgNoticeEvent(_Event):
    type: Literal["bg_notice"]
    kind: str
    text: str
    label: str | None = None
    data: str | None = None
    mime: str | None = None


class NavigateEvent(_Event):
    """open_screen: the pages showing the asking session go to a destination, or one item there (set fields only)."""
    type: Literal["navigate"]
    destination: Literal["home", "sessions", "brain", "tasks", "routines", "settings"]
    running: bool  # sessions: only Running now
    folder: str | None  # sessions: the session's folder
    session: str | None  # sessions: open this session
    note: str | None  # brain: a note waiting for a verdict (path in the vault)
    task: str | None  # tasks: a tracker task id
    routine: str | None  # routines: the routine's page (its last run)


class HomeTask(_Msg):
    text: str
    file: str  # relative to the vault
    line: int
    mtime: float
    raw: str  # the exact line, sent back as `expect` when the task changes


class HomeNote(_Msg):
    title: str
    file: str
    mtime: float


class HomeAwait(_Msg):
    """A note waiting for the owner's verdict (fact-checked with no human_verdict, or AI-curated and unreviewed)."""
    title: str
    file: str
    mtime: float
    tag: str  # "AI" | "unverified view" | "your note" | "capture"
    verified: int | None = None  # percent of claims verified, when the note says
    published: str = ""  # the post's own date (YYYY-MM-DD), when the note says
    topic: str = ""  # the note's cluster
    score: int | None = None  # value_score 0..10 from the vault's nightly run, when scored
    why: str = ""  # value_why: one line on what the note gives the owner
    lane: str = ""  # "news" | "learning" | ""


class HomeEvent(_Event):
    """The home screen's notes part (home.summary): open tasks and recent notes in the vault."""
    type: Literal["home"]
    vault: str
    tasks: list[HomeTask]
    open_tasks: int
    snoozed: int
    notes: list[HomeNote]
    notes_week: int
    awaiting: list[HomeAwait] = []
    awaiting_count: int = 0


class Reminder(_Msg):
    text: str
    due: str | None = None  # YYYY-MM-DD
    days: int | None = None  # days left; negative = overdue
    url: str | None = None


class PinnedLink(_Msg):
    label: str
    url: str


class DirtyRepo(_Msg):
    path: str
    label: str
    branch: str | None = None
    changed: int  # uncommitted files
    ahead: int | None = None  # commits not pushed; None = no upstream


class OpenPr(_Msg):
    repo: str
    number: int
    title: str
    url: str
    updated: float
    idle_days: int
    stale: bool
    draft: bool


class TrackerTask(_Msg):
    id: int
    title: str
    project: str
    project_id: int = 0
    due: str | None = None
    created: str = ""
    priority: int
    updated: float
    url: str
    labels: list[str] = []  # the tracker's label names, read only (a pin label pins an overdue task as money)


ItemSource = Literal["vikunja", "prs", "repos", "notes", "tasks"]


class ItemColumn(_Msg):
    key: str
    label: str
    kind: Literal["title", "repo", "text", "chip", "due", "priority", "num", "age"] = "text"


class PlanItem(_Msg):
    """One row of Home's plan (needs.py). title is ours; reason is the rule's, or the model's while that item's facts are
    unchanged (plain text, from untrusted data)."""
    key: str  # unique on the page: "routine:<id>", "vikunja:<id>", "setup:<section>", "reminder:<due>:<text>"
    kind: Literal["approval", "setup", "routine", "reminder", "task", "note_task", "result", "pr", "notes_batch"]
    id: str  # what the page opens: routine id, tracker task id, the Settings section that fixes a broken setup
    title: str
    reason: str
    source: str | None = None  # the tracker's project, "routine"
    due: str | None = None  # YYYY-MM-DD
    priority: int | None = None
    url: str | None = None
    actions: list[Literal["open", "start", "done", "later", "delegate", "make_task"]] = []
    repo: str | None = None  # a tracker task's repo from the repo map (label); None: Delegate asks for one
    suggest: Literal["take now", "delegate", "later"] | None = None  # tasks only: the rule's action (suggest.py), a hint
    urgent: bool = False  # Needs you only: a broken setup, an urgent routine (routines.urgent), or one past ESCALATE_H; shown red
    pin: Literal["security", "client", "money"] | None = None  # Needs you only: the class a rule pinned it in (docs/adr/0012); it leads
    repair: int | None = None  # a routine row: its open Repair task's id ("Task #N"); url is that task's link


class PlanEvent(_Event):
    """Home's plan. needs_you is decided by rules (docs/adr/0001): a broken setup, routines with a problem, reminders
    due today or earlier, then tasks due before today; approvals sit above it on the page. The queue (next, then up_next) is the rest worth doing. A model may
    only reorder both and give reasons."""
    type: Literal["plan"]
    needs_you: list[PlanItem]
    next: PlanItem | None = None  # the next action: holds its place until started or gone, or a new ranking
    up_next: list[PlanItem] = []  # at most 5
    ranked_at: float | None = None  # when the last ranking was made
    stale: bool = False  # no ranking for exactly these items: rule order
    busy: bool = False  # a new ranking is being made
    error: str | None = None


class ItemRow(_Msg):
    id: str
    title: str
    repo: str | None = None  # label of the repo "Start in Orb" would use; None = no repo here
    hot: bool = False
    cells: dict[str, str]  # one value per column key
    status: str = ""  # which `statuses` filter value the row belongs to ("" = none)


class ItemListEvent(_Event):
    """One table (items.list_): its columns and rows. `group_key` is the column to group by ("repo" = the Repo column)."""
    type: Literal["item_list"]
    source: ItemSource
    kicker: str
    heading: str
    columns: list[ItemColumn]
    rows: list[ItemRow]
    group_key: str | None = None
    can_archive: bool = False
    can_judge: bool = False  # the Notes list: rows can be selected for a bulk verdict (notes_verdict)
    statuses: list[str] = []  # the status filter's values (rows carry one in `status`); empty = no status filter
    status_default: str = ""  # the value the filter starts on ("" = all)
    can_suggest: bool = False  # the Tasks list: "Suggest priorities" (tasks_suggest) fills the Suggested column
    busy: bool = False  # a suggestion run is in progress
    url: str | None = None
    url_label: str | None = None
    error: str | None = None  # the list can't be read (Tasks: "Vikunja not reachable: <reason>", or Jira), shown in place of the table


class HomeForgetEvent(_Event):
    """Home's Don't forget pane (forget.summary): reminders, unsaved repos, open PRs; and the pinned links."""
    type: Literal["home_forget"]
    reminders: list[Reminder]
    links: list[PinnedLink]
    repos: list[DirtyRepo]
    prs: list[OpenPr]


class HomeTasksEvent(_Event):
    """Home's view of the Tasks source (tracker.home_event): the first open tasks and the count, or why the tracker
    can't be read. `tasks` is None when no tracker is set up (Home counts the notes' tasks instead)."""
    type: Literal["home_tasks"]
    tasks: list[TrackerTask] | None
    total: int
    url: str | None = None
    error: str | None = None


class AwayLine(_Msg):
    """One thing that finished without the owner: a routine's latest ok Run (count: its Runs since they left), the
    vault's "3 pages expired" (opens Brain's Expired view), or Orb's own "2 sessions finished" (opens Sessions) /
    "1 delegation Ready" (opens the Delegated strip); count: how many."""
    kind: Literal["routine", "expired", "finished", "ready"]
    id: str
    title: str
    summary: str = ""
    count: int = 1


class AwayRecap(_Msg):
    since: float  # the owner's last action before they were away
    back: float | None = None  # their first action back; None while they are still away (the span still grows)
    heading: str  # "While you were away · 2 days"
    lines: list[AwayLine] = []  # at most away.LINES
    more: int = 0  # lines past those: "N more"


class AwayRecapEvent(_Event):
    """Home's Away recap (away.Clock): the one-shot card after 24 hours or more without the owner acting, or None."""
    type: Literal["away_recap"]
    recap: AwayRecap | None


class TaskLine(_Msg):
    n: int
    text: str


class TaskDetailEvent(_Event):
    """One task in its note (tasks.detail): the line, the note's title and heading, the lines around it."""
    type: Literal["task_detail"]
    file: str
    line: int
    raw: str
    title: str
    heading: str
    mtime: float
    context: list[TaskLine]


class ItemEvent(_Event):
    """One item in full (items.get): chips, plain-text body, the repo it maps to (label, None = no repo), the prompt to copy."""
    type: Literal["item"]
    source: ItemSource
    id: str
    title: str
    kicker: str
    chips: list[str]
    body: str
    url: str | None = None
    url_label: str | None = None
    repo: str | None = None
    brief: str
    done: bool = False
    can_archive: bool = False


class BrainNote(_Msg):
    """One note on Brain's list (home.brain_notes)."""
    file: str  # relative to the notes folder
    title: str
    kind: str  # "AI", "your note", "capture", "unverified view"
    mtime: float
    score: int | None  # value_score 0..10, None = not scored
    lane: str  # "news", "learning" or ""
    why: str  # value_why
    waiting: bool  # waits for the owner's verdict
    verdict: str  # "" or "reject 2026-10-24" (sent back as `seen`)
    owner_read: str  # "" or the day the owner read it
    suggest: Literal["approve", "reject", ""] = ""  # a waiting note's suggested verdict (suggest.note); never "drop"
    expires: str = ""  # the day the vault will archive it (brain.expiry, docs/adr/0013), "" when the expiry rule doesn't cover it


class BrainListEvent(_Event):
    """Brain's list: the newest notes, newest first. `error` when there is no notes folder."""
    type: Literal["brain_list"]
    notes: list[BrainNote]
    error: str | None = None


class ExpiredNote(BrainNote):
    archived: str  # the day the vault archived it (`auto_archived`, its local day)


class BrainExpiredEvent(_Event):
    """Brain's Expired view (home.expired_notes): pages the vault archived in the last 30 days, newest first. Read
    only: Orb never writes `auto_archived`; Keep is the approve verdict. `error` when there is no notes folder."""
    type: Literal["brain_expired"]
    notes: list[ExpiredNote]
    error: str | None = None


class BrainNoteEvent(BrainNote, _Event):
    """One note's page: the list fields and the body under the frontmatter, as plain text."""
    type: Literal["brain_note"]
    body: str


class BrainApplied(_Msg):
    file: str
    verdict: Literal["approve", "reject", "restore"]


class BrainRefused(_Msg):
    file: str
    reason: str  # the vault write module's refusal ("The note changed since Orb read it…")


class BrainAppliedEvent(_Event):
    """The answer to brain_apply, before the new list: what was written (each with the verdict asked for) and what the
    vault write module refused, with its reason."""
    type: Literal["brain_applied"]
    applied: list[BrainApplied]
    refused: list[BrainRefused]


class TaskChangedEvent(_Event):
    """A task line was rewritten (tasks.act); `previous` is what Undo puts back."""
    type: Literal["task_changed"]
    file: str
    line: int
    action: Literal["done", "drop", "snooze", "restore"]
    raw: str
    previous: str


class UserEvent(_Event):
    type: Literal["user"]
    text: str
    source: str
    id: str | None = None
    screen: str | None = None  # the page it was asked about (Home, Task…), if not the chat


class TextStartEvent(_Event):
    type: Literal["text_start"]
    block: str


class TextEvent(_Event):
    type: Literal["text"]
    block: str
    delta: str


class SaidEvent(_Event):
    type: Literal["said"]
    block: str
    delta: str


class ToolStartEvent(_Event):
    type: Literal["tool_start"]
    id: str | None
    name: str | None
    block: Any = None


class ToolInputEvent(_Event):
    type: Literal["tool_input"]
    id: str | None
    name: str | None
    input: Json
    summary: str
    parent: str | None = None


class ToolResultEvent(_Event):
    type: Literal["tool_result"]
    tool_use_id: str | None
    is_error: bool
    content: str
    truncated: bool
    parent: str | None = None


class ResultEvent(_Event):
    type: Literal["result"]
    subtype: str | None = None
    is_error: bool | None = None
    duration_ms: int | None = None
    num_turns: int | None = None
    session_id: str | None = None
    stop_reason: str | None = None


class TimingEvent(_Event):
    type: Literal["timing"]
    turn: str
    source: str
    model: str | None
    hops: Json


class PartialEvent(_Event):
    type: Literal["partial"]
    text: str


class HeardNothingEvent(_Event):
    type: Literal["heard_nothing"]


class PinFocusedEvent(_Event):
    type: Literal["pin_focused"]


class HeldEvent(_Event):
    type: Literal["held"]
    text: str


class PermissionEvent(_Event):
    type: Literal["permission"]
    id: str
    tool: str
    input: Json
    summary: str
    tool_use_id: str | None = None
    title: str | None = None
    description: str | None = None
    blocked_path: str | None = None


class PermissionDoneEvent(_Event):
    type: Literal["permission_done"]
    id: str
    allow: bool
    heard: str | None = None
    answers: Json | None = None


class UndoAvailableEvent(_Event):
    type: Literal["undo_available"]
    user_id: str
    files: list[str]


class UndoConfirmEvent(_Event):
    type: Literal["undo_confirm"]
    id: str
    user_id: str | None
    files: list[str]
    note: str
    # server-side bookkeeping that travels with the card (leading underscore = not for display)
    later: Any = Field(default=None, alias="_later")
    created: Any = Field(default=None, alias="_created")


class UndoDoneEvent(_Event):
    type: Literal["undo_done"]
    id: str
    ok: bool
    user_id: str | None = None
    files: list[str] | None = None
    heard: str | None = None
    error: str | None = None


class AudioEvent(_Event):
    type: Literal["audio"]
    gen: int
    seq: int
    text: str
    mime: str | None = None
    data: str | None = None
    speak: bool | None = None


class SpeechResetEvent(_Event):
    type: Literal["speech_reset"]
    gen: int


class DelegateCardRow(_Msg):
    task: int
    title: str
    branch: str


class DelegateCardEvent(_Event):
    """Delegate's grant card (ADR 0005): the repo, the branch and what the session may do without asking. A bulk
    Delegate has one card per repo: `rows` are its tasks (task/title/branch are the first), `more` the repos still to
    ask about after this one."""
    type: Literal["delegate_card"]
    id: str
    task: int
    title: str
    repo: str  # label
    branch: str
    covers: list[str]
    rows: list[DelegateCardRow] = []
    more: int = 0


class DelegationItem(_Msg):
    """One row of the Delegated strip, in the order they were delegated. `line` is the stage in plain words."""
    id: str
    task: int
    title: str
    repo: str  # label
    branch: str
    stage: Literal["queued", "working", "testing", "pushing", "ready", "failed", "applied", "reverted", "stopped"]
    line: str
    session: str
    folder: str  # the worktree, to open the session
    conflict: str | None = None  # the last Apply hit a conflict: nothing was merged
    apply_text: str
    # Why it can't finish without you (Home's Needs you): a card the grant doesn't cover, the check failed after
    # its last turn, no event for 20 min while Working, the server restarted while it ran, or Ready with push and its
    # PR waiting for your OK (#771). None while it can.
    needs: Literal["card", "failed", "stuck", "stopped", "outward"] | None = None
    ask: str | None = None  # the card it waits on, in its words; or the outward question
    pr: int | None = None  # the PR Orb opened for its branch
    pr_url: str | None = None


class DelegationsEvent(_Event):
    type: Literal["delegations"]
    items: list[DelegationItem]


class DelegationDiffEvent(_Event):
    """Review: the delegation's own work (snapshot..branch), stat then patch, capped."""
    type: Literal["delegation_diff"]
    id: str
    branch: str
    diff: str


class MakeTaskCardEvent(_Event):
    """"Make it a task": the card to allow or deny before Orb creates a task in the tracker (ADR 0008, 0010)."""
    type: Literal["make_task_card"]
    id: str
    routine: str
    title: str
    project: str


class MakeTaskDoneEvent(_Event):
    """The card's outcome: created (`task`, `url`), denied (ok false, no error) or failed (`error`)."""
    type: Literal["make_task_done"]
    id: str
    ok: bool
    task: int | None = None
    title: str | None = None
    url: str | None = None
    project: str | None = None
    error: str | None = None


class MakeTaskUndoneEvent(_Event):
    """Undo of a created task: deleted, or why not."""
    type: Literal["make_task_undone"]
    task: int
    ok: bool
    error: str | None = None


class DropRoutedEvent(_Event):
    """A drop on Home, routed and running in the background (intake.py, ADR 0009); refused: why."""
    type: Literal["drop_routed"]
    ok: bool
    text: str  # the route's label ("YouTube → transcript"), or why the drop was refused
    route: str | None = None
    id: str | None = None  # the drop; its drop_done carries it
    session: str | None = None  # a session's drop: its key in `folder` (its status is the progress until drop_done)
    folder: str | None = None


class DropDoneEvent(_Event):
    """A drop ended (every page): a job's "Saved: <title>" and the note it wrote, a session's first turn ("Saved",
    "Answered"), or why it failed."""
    type: Literal["drop_done"]
    id: str
    ok: bool
    text: str
    note: str | None = None  # vault-relative path


ServerEvent = Annotated[Union[
    HelloEvent, FeaturesEvent, FoldersEvent, SetupStatusEvent, BrowseEvent, PickedEvent, VoiceSampleEvent,
    SettingsEvent, ErrorEvent, NoticeEvent, OpenedEvent, HistoryEvent, StateEvent, SessionInfoEvent,
    ContextEvent, TaskEvent, CommandsEvent, McpEvent, RateLimitEvent, RoutinesEvent, BgNoticeEvent, NavigateEvent,
    HomeEvent, HomeForgetEvent, HomeTasksEvent, AwayRecapEvent, PlanEvent, TaskDetailEvent, ItemEvent, ItemListEvent, BrainListEvent, BrainExpiredEvent, BrainNoteEvent, BrainAppliedEvent, TaskChangedEvent, UserEvent, TextStartEvent, TextEvent, SaidEvent, ToolStartEvent, ToolInputEvent, ToolResultEvent,
    ResultEvent, TimingEvent, PartialEvent, HeardNothingEvent, PinFocusedEvent, HeldEvent, PermissionEvent,
    PermissionDoneEvent, UndoAvailableEvent, UndoConfirmEvent, UndoDoneEvent, AudioEvent, SpeechResetEvent,
    DelegateCardEvent, DelegationsEvent, DelegationDiffEvent,
    MakeTaskCardEvent, MakeTaskDoneEvent, MakeTaskUndoneEvent, DropRoutedEvent, DropDoneEvent,
], Field(discriminator="type")]


# -- page -> server -------------------------------------------------------------------------------

class SetupStatusMsg(_Msg):
    type: Literal["setup_status"]


class BrowseMsg(_Msg):
    type: Literal["browse"]
    path: str | None = None


class PickFolderMsg(_Msg):
    type: Literal["pick_folder"]


class OpenFolderMsg(_Msg):
    type: Literal["open_folder"]
    path: str
    session: str | None = None


class AddFolderMsg(_Msg):
    type: Literal["add_folder"]
    path: str


class StartSessionMsg(_Msg):
    type: Literal["start_session"]
    path: str


class PinFolderMsg(_Msg):
    type: Literal["pin_folder"]
    path: str
    pinned: bool = True


class GetSettingsMsg(_Msg):
    type: Literal["get_settings"]


class SetSettingsMsg(_Msg):
    type: Literal["set_settings"]
    values: Json | None = None
    vocabulary: str | None = None


class VoiceSampleMsg(_Msg):
    type: Literal["voice_sample"]
    voice: str | None = None


class KokoroSetupMsg(_Msg):
    """One click: install what's missing of VoiceMode's Kokoro, keep it on 127.0.0.1, (re)start it."""
    type: Literal["kokoro_setup"]


class RescanMsg(_Msg):
    type: Literal["rescan"]


class RoutinesMsg(_Msg):
    type: Literal["routines"]
    refresh: bool | None = None


class RoutinesSeenMsg(_Msg):
    """Read a run: one routine (`id`), every run worth reading (`all`), or, with neither, whatever doesn't notify."""
    type: Literal["routines_seen"]
    id: str | None = None
    all: bool = False


class RoutinesResolveMsg(_Msg):
    """Mark a routine's last run resolved (its judged problem is dealt with), or `undo` that."""
    type: Literal["routines_resolve"]
    id: str
    undo: bool = False


class MuteMsg(_Msg):
    type: Literal["mute"]
    value: bool


class NewSessionMsg(_Msg):
    type: Literal["new_session"]


class ArchiveSessionMsg(_Msg):
    type: Literal["archive_session"]
    folder: str
    key: str
    archived: bool = True


class RemoveSessionMsg(_Msg):
    type: Literal["remove_session"]
    folder: str
    key: str


class UserTextMsg(_Msg):
    type: Literal["user_text"]
    text: str
    interrupt: bool | None = None


class SpeechStartMsg(_Msg):
    type: Literal["speech_start"]
    echo_risk: bool | None = None


class BargeInMsg(_Msg):
    type: Literal["barge_in"]


class SpeechCancelledMsg(_Msg):
    type: Literal["speech_cancelled"]


class UtteranceMsg(_Msg):
    type: Literal["utterance"]
    wav: str  # base64 16 kHz mono WAV


class VoiceTextMsg(_Msg):
    type: Literal["voice_text"]
    text: str
    echo_risk: bool | None = None


class HomeMsg(_Msg):
    type: Literal["home"]
    rerank: bool = False  # ask the model to rank the plan again now, even if nothing changed


class PlanStartMsg(_Msg):
    """Home started a queue item (by its plan key): it leaves the queue for today, the next one moves up."""
    type: Literal["plan_start"]
    key: str


class AwaySeenMsg(_Msg):
    """The Away recap was closed, or Home left while it showed: it goes on every page."""
    type: Literal["away_seen"]


class PlanLaterMsg(_Msg):
    """Later on a queue item: hidden until the next day on every page (never written to a tracker)."""
    type: Literal["plan_later"]
    key: str


class PlanDoneMsg(_Msg):
    """Done on a queue task ("vikunja:<id>" or "note:<file>:<line>"): written at once; undo=True reopens the tracker's task."""
    type: Literal["plan_done"]
    key: str
    undo: bool = False


class ScreenMsg(_Msg):
    """What the page shows now, as plain text; name None = the chat itself (nothing rides along)."""
    type: Literal["screen"]
    name: str | None = None
    text: str = ""


class TaskDetailMsg(_Msg):
    type: Literal["task_detail"]
    file: str
    line: int


class ItemListMsg(_Msg):
    type: Literal["item_list"]
    source: ItemSource


class ItemGetMsg(_Msg):
    type: Literal["item_get"]
    source: ItemSource
    id: str


class ItemDoneMsg(_Msg):
    """Archive: mark a tracker task done (done=False brings it back). The server answers with the new item_list."""
    type: Literal["item_done"]
    source: ItemSource
    id: str
    done: bool = True


class TasksBulkMsg(_Msg):
    """Bulk change on tracker tasks (ids as the list shows them): `done` archives (or reopens) them, `priority` (0 to 5)
    sets their priority. Exactly one of the two. The page confirms with a count first."""
    type: Literal["tasks_bulk"]
    ids: list[str]
    done: bool | None = None
    priority: int | None = None


class TasksSuggestMsg(_Msg):
    """Ask for AI-suggested priorities for the open tasks (one Haiku call, subscription only). Nothing is written to the tracker."""
    type: Literal["tasks_suggest"]


class SeenNote(_Msg):
    file: str  # relative to the notes folder
    seen: str = ""  # its verdict as the page showed it (the row's Verdict cell): "" or "reject 2026-10-24"


class NotesVerdictMsg(_Msg):
    """Bulk verdict on notes: approve, reject, or restore (waits again). The page confirms with a count first; the
    vault write module writes only if every note's verdict still reads as `seen`, then the server answers with the new list."""
    type: Literal["notes_verdict"]
    notes: list[SeenNote]
    verdict: Literal["approve", "reject", "restore"]


class BrainListMsg(_Msg):
    type: Literal["brain_list"]


class BrainExpiredMsg(_Msg):
    type: Literal["brain_expired"]


class BrainGetMsg(_Msg):
    type: Literal["brain_get"]
    file: str


class VerdictNote(SeenNote):
    verdict: Literal["approve", "reject", "restore"]


class BrainApplyMsg(_Msg):
    """Verdicts on Brain's list, one per note (accepting a suggestion, Apply suggestions, Restore). Each goes through the
    vault write module on its own: a refused note doesn't stop the others. The server answers with brain_applied, then
    the list."""
    type: Literal["brain_apply"]
    notes: list[VerdictNote]


class BrainVerdictMsg(_Msg):
    """A verdict on the open note: approve, reject, or restore (waits again). Written only if the note's verdict still
    reads `seen`; the server answers with the note and the list."""
    type: Literal["brain_verdict"]
    file: str
    verdict: Literal["approve", "reject", "restore"]
    seen: str = ""


class BrainReadMsg(_Msg):
    """The owner left an open note without a verdict: owner_read is set once, if it still reads `seen` ("")."""
    type: Literal["brain_read"]
    file: str
    seen: str = ""


class ItemStartMsg(_Msg):
    """Start in Orb: a new session in the item's repo (found by the server), first request = the brief."""
    type: Literal["item_start"]
    source: ItemSource
    id: str


class TaskActionMsg(_Msg):
    type: Literal["task_action"]
    file: str
    line: int
    expect: str  # the line as the page shows it; the server writes only if it still reads so
    action: Literal["done", "drop", "snooze", "restore"]
    until: str | None = None  # snooze: YYYY-MM-DD
    value: str | None = None  # restore: the line to put back


class MakeTaskMsg(_Msg):
    """"Make it a task" on a routine's last run: the server answers with a card first."""
    type: Literal["make_task"]
    routine: str


class MakeTaskConfirmMsg(_Msg):
    type: Literal["make_task_confirm"]
    id: str
    ok: bool


class MakeTaskUndoMsg(_Msg):
    """Delete a task this server created with "Make it a task"; any other id is refused."""
    type: Literal["make_task_undo"]
    task: int


class InterruptMsg(_Msg):
    type: Literal["interrupt"]


class PlaybackMsg(_Msg):
    type: Literal["playback"]
    turn: str
    vad_ms: int
    play_ms: int


class PermissionMsg(_Msg):
    type: Literal["permission"]
    id: str
    allow: bool
    answers: Json | None = None


class ReadAllMsg(_Msg):
    type: Literal["read_all"]
    text: str


class DictateNoteMsg(_Msg):
    type: Literal["dictate_note"]


class UndoRequestMsg(_Msg):
    type: Literal["undo_request"]
    user_id: str | None = None


class UndoConfirmMsg(_Msg):
    type: Literal["undo_confirm"]
    id: str
    ok: bool


class McpStatusMsg(_Msg):
    type: Literal["mcp_status"]


class McpReconnectMsg(_Msg):
    type: Literal["mcp_reconnect"]
    name: str


class SetModeMsg(_Msg):
    type: Literal["set_mode"]
    mode: Literal["default", "auto", "plan"]


class SetModelMsg(_Msg):
    type: Literal["set_model"]
    model: Literal["haiku", "sonnet", "opus"]


class RevokeGrantMsg(_Msg):
    """Drop a delegation's grant (ADR 0005): every later tool call of that session raises a card again."""
    type: Literal["revoke_grant"]
    session: str


class DelegateMsg(_Msg):
    """Delegate on a tracker task: the server answers with the grant card. `path`: the picker's repo, for a task whose
    project has no mapped repo (this delegation only)."""
    type: Literal["delegate"]
    task: int
    path: str | None = None


class DelegateBulkMsg(_Msg):
    """Bulk Delegate from Up next: tracker tasks with a known repo. The server answers with the first repo's card; the
    others follow, one per repo, whatever the answer."""
    type: Literal["delegate_bulk"]
    tasks: list[int]


class DelegateConfirmMsg(_Msg):
    type: Literal["delegate_confirm"]
    id: str
    ok: bool


class DelegationReviewMsg(_Msg):
    type: Literal["delegation_review"]
    id: str


class DelegationApplyMsg(_Msg):
    type: Literal["delegation_apply"]
    id: str


class DelegationRevertMsg(_Msg):
    """Undo after Apply: revert the commit and reopen the task."""
    type: Literal["delegation_revert"]
    id: str


class DelegationRetryMsg(_Msg):
    """Failed or stuck: the same session gets what went wrong as its next request (a stuck turn is stopped first)."""
    type: Literal["delegation_retry"]
    id: str


class DelegationResumeMsg(_Msg):
    """Stopped by restart: continue the same session in the same worktree under the same grant."""
    type: Literal["delegation_resume"]
    id: str


class DelegationOutwardMsg(_Msg):
    """The outward card (Needs you): Allow pushes the branch and opens its PR; Skip (allow false) keeps it local."""
    type: Literal["delegation_outward"]
    id: str
    allow: bool


class DelegationDiscardMsg(_Msg):
    """Discard: stop the session, drop the branch and worktree. On an applied or reverted one: dismiss the row."""
    type: Literal["delegation_discard"]
    id: str


class DropMsg(_Msg):
    """Home's drop zone: one pasted link, or one file (name + base64 bytes)."""
    type: Literal["drop"]
    url: str | None = None
    name: str | None = None
    data: str | None = None


ClientMessage = Annotated[Union[
    SetupStatusMsg, BrowseMsg, PickFolderMsg, OpenFolderMsg, AddFolderMsg, StartSessionMsg, PinFolderMsg,
    GetSettingsMsg, SetSettingsMsg, VoiceSampleMsg, KokoroSetupMsg, RescanMsg, RoutinesMsg, RoutinesSeenMsg, RoutinesResolveMsg, MuteMsg,
    NewSessionMsg, ArchiveSessionMsg, RemoveSessionMsg, UserTextMsg, SpeechStartMsg, BargeInMsg, SpeechCancelledMsg, UtteranceMsg, VoiceTextMsg,
    HomeMsg, AwaySeenMsg, PlanStartMsg, PlanLaterMsg, PlanDoneMsg, ScreenMsg, TaskDetailMsg, ItemListMsg, ItemGetMsg, ItemDoneMsg, TasksBulkMsg, TasksSuggestMsg, NotesVerdictMsg, BrainListMsg, BrainExpiredMsg, BrainGetMsg, BrainApplyMsg, BrainVerdictMsg, BrainReadMsg, ItemStartMsg, TaskActionMsg, InterruptMsg, PlaybackMsg, PermissionMsg, ReadAllMsg, DictateNoteMsg, UndoRequestMsg, UndoConfirmMsg,
    McpStatusMsg, McpReconnectMsg, SetModeMsg, SetModelMsg, RevokeGrantMsg, DelegateMsg, DelegateBulkMsg, DelegateConfirmMsg, MakeTaskMsg, MakeTaskConfirmMsg, MakeTaskUndoMsg,
    DelegationReviewMsg, DelegationApplyMsg, DelegationRevertMsg, DelegationDiscardMsg, DelegationRetryMsg,
    DelegationResumeMsg, DelegationOutwardMsg, DropMsg,
], Field(discriminator="type")]


def _members(union: Any) -> list[type[BaseModel]]:
    return list(union.__origin__.__args__) if hasattr(union, "__origin__") else []


SERVER_EVENTS: dict[str, type[BaseModel]] = {
    m.model_fields["type"].annotation.__args__[0]: m for m in _members(ServerEvent)}
CLIENT_MESSAGES: dict[str, type[BaseModel]] = {
    m.model_fields["type"].annotation.__args__[0]: m for m in _members(ClientMessage)}


def _untitle(node: Any, keep: bool = False) -> Any:
    """Drop the per-field titles Pydantic adds (they become one TypeScript alias per field); keep model
    titles, and keep every key of a "properties" map (a field may be called "title")."""
    if isinstance(node, dict):
        return {k: _untitle(v, k in ("$defs", "properties")) for k, v in node.items() if not (k == "title" and not keep)}
    if isinstance(node, list):
        return [_untitle(v) for v in node]
    return node


def schema() -> dict:
    """One JSON Schema with both unions, for the TypeScript generator."""
    server = TypeAdapter(ServerEvent).json_schema(ref_template="#/$defs/{model}", by_alias=True)
    client = TypeAdapter(ClientMessage).json_schema(ref_template="#/$defs/{model}", by_alias=True)
    defs = {**server.pop("$defs", {}), **client.pop("$defs", {})}
    defs = {name: {**_untitle(d), **({"title": d["title"]} if "title" in d else {})} for name, d in defs.items()}
    defs["ServerEvent"], defs["ClientMessage"] = _untitle(server), _untitle(client)
    # Mixed into hello / features rather than referenced, so it gets its own entry for the page.
    defs["Features"] = {**_untitle(Features.model_json_schema()), "title": "Features"}
    return {"$schema": "http://json-schema.org/draft-07/schema#", "title": "OrbProtocol",
            "type": "object", "properties": {"server": {"$ref": "#/$defs/ServerEvent"},
                                             "client": {"$ref": "#/$defs/ClientMessage"}},
            "$defs": defs}


def main() -> None:
    """`orb-protocol [path]`: write the schema (default web/src/protocol.schema.json, else stdout with -)."""
    out = sys.argv[1] if len(sys.argv) > 1 else "web/src/protocol.schema.json"
    text = json.dumps(schema(), indent=2, sort_keys=True) + "\n"
    if out == "-":
        sys.stdout.write(text)
    else:
        Path(out).write_text(text)
