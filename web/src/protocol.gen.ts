// Generated from src/orb/protocol.py (uv run orb-protocol && npm run gen:protocol). Do not edit.

/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ClientMessage".
 */
export type ClientMessage =
  | SetupStatusMsg
  | BrowseMsg
  | PickFolderMsg
  | OpenFolderMsg
  | AddFolderMsg
  | StartSessionMsg
  | PinFolderMsg
  | GetSettingsMsg
  | SetSettingsMsg
  | VoiceSampleMsg
  | KokoroSetupMsg
  | RescanMsg
  | RoutinesMsg
  | RoutinesSeenMsg
  | RoutinesResolveMsg
  | MuteMsg
  | NewSessionMsg
  | ArchiveSessionMsg
  | RemoveSessionMsg
  | UserTextMsg
  | SpeechStartMsg
  | BargeInMsg
  | SpeechCancelledMsg
  | UtteranceMsg
  | VoiceTextMsg
  | HomeMsg
  | AwaySeenMsg
  | PlanStartMsg
  | PlanLaterMsg
  | PlanLeaveMsg
  | PlanDoneMsg
  | ScreenMsg
  | TaskDetailMsg
  | ItemListMsg
  | ItemGetMsg
  | ItemDoneMsg
  | TasksBulkMsg
  | TasksSuggestMsg
  | NotesVerdictMsg
  | BrainListMsg
  | BrainExpiredMsg
  | BrainNoTopicMsg
  | BrainKeepMsg
  | BrainGetMsg
  | BrainApplyMsg
  | BrainVerdictMsg
  | BrainReadMsg
  | ItemStartMsg
  | TaskActionMsg
  | InterruptMsg
  | PlaybackMsg
  | PermissionMsg
  | ReadAllMsg
  | DictateNoteMsg
  | UndoRequestMsg
  | UndoConfirmMsg
  | McpStatusMsg
  | McpReconnectMsg
  | SetModeMsg
  | SetModelMsg
  | RevokeGrantMsg
  | DelegateMsg
  | DelegateBulkMsg
  | DelegateConfirmMsg
  | MakeTaskMsg
  | MakeTaskConfirmMsg
  | MakeTaskUndoMsg
  | DelegationReviewMsg
  | DelegationApplyMsg
  | DelegationRevertMsg
  | DelegationDiscardMsg
  | DelegationRetryMsg
  | DelegationResumeMsg
  | DelegationOutwardMsg
  | DropMsg;
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ServerEvent".
 */
export type ServerEvent =
  | HelloEvent
  | FeaturesEvent
  | FoldersEvent
  | SetupStatusEvent
  | BrowseEvent
  | PickedEvent
  | VoiceSampleEvent
  | SettingsEvent
  | ErrorEvent
  | NoticeEvent
  | OpenedEvent
  | HistoryEvent
  | StateEvent
  | SessionInfoEvent
  | ContextEvent
  | TaskEvent
  | CommandsEvent
  | McpEvent
  | RateLimitEvent
  | RoutinesEvent
  | BgNoticeEvent
  | NavigateEvent
  | HomeEvent
  | HomeForgetEvent
  | HomeTasksEvent
  | AwayRecapEvent
  | PlanEvent
  | TaskDetailEvent
  | ItemEvent
  | ItemListEvent
  | BrainListEvent
  | BrainExpiredEvent
  | BrainNoTopicEvent
  | BrainNoteEvent
  | BrainAppliedEvent
  | TaskChangedEvent
  | UserEvent
  | TextStartEvent
  | TextEvent
  | SaidEvent
  | ToolStartEvent
  | ToolInputEvent
  | ToolResultEvent
  | ResultEvent
  | TimingEvent
  | PartialEvent
  | HeardNothingEvent
  | PinFocusedEvent
  | HeldEvent
  | PermissionEvent
  | PermissionDoneEvent
  | UndoAvailableEvent
  | UndoConfirmEvent
  | UndoDoneEvent
  | AudioEvent
  | SpeechResetEvent
  | DelegateCardEvent
  | DelegationsEvent
  | DelegationDiffEvent
  | MakeTaskCardEvent
  | MakeTaskDoneEvent
  | MakeTaskUndoneEvent
  | DropRoutedEvent
  | DropDoneEvent;

export interface OrbProtocol {
  client?: ClientMessage;
  server?: ServerEvent;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SetupStatusMsg".
 */
export interface SetupStatusMsg {
  type: "setup_status";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrowseMsg".
 */
export interface BrowseMsg {
  path?: string | null;
  type: "browse";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PickFolderMsg".
 */
export interface PickFolderMsg {
  type: "pick_folder";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "OpenFolderMsg".
 */
export interface OpenFolderMsg {
  path: string;
  session?: string | null;
  type: "open_folder";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AddFolderMsg".
 */
export interface AddFolderMsg {
  path: string;
  type: "add_folder";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "StartSessionMsg".
 */
export interface StartSessionMsg {
  path: string;
  type: "start_session";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PinFolderMsg".
 */
export interface PinFolderMsg {
  path: string;
  pinned?: boolean;
  type: "pin_folder";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "GetSettingsMsg".
 */
export interface GetSettingsMsg {
  type: "get_settings";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SetSettingsMsg".
 */
export interface SetSettingsMsg {
  type: "set_settings";
  values?: {
    [k: string]: unknown;
  } | null;
  vocabulary?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "VoiceSampleMsg".
 */
export interface VoiceSampleMsg {
  type: "voice_sample";
  voice?: string | null;
}
/**
 * One click: install what's missing of VoiceMode's Kokoro, keep it on 127.0.0.1, (re)start it.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "KokoroSetupMsg".
 */
export interface KokoroSetupMsg {
  type: "kokoro_setup";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RescanMsg".
 */
export interface RescanMsg {
  type: "rescan";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutinesMsg".
 */
export interface RoutinesMsg {
  refresh?: boolean | null;
  type: "routines";
}
/**
 * Read a run: one routine (`id`), every run worth reading (`all`), or, with neither, whatever doesn't notify.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutinesSeenMsg".
 */
export interface RoutinesSeenMsg {
  all?: boolean;
  id?: string | null;
  type: "routines_seen";
}
/**
 * Mark a routine's last run resolved (its judged problem is dealt with), or `undo` that.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutinesResolveMsg".
 */
export interface RoutinesResolveMsg {
  id: string;
  type: "routines_resolve";
  undo?: boolean;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MuteMsg".
 */
export interface MuteMsg {
  type: "mute";
  value: boolean;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "NewSessionMsg".
 */
export interface NewSessionMsg {
  type: "new_session";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ArchiveSessionMsg".
 */
export interface ArchiveSessionMsg {
  archived?: boolean;
  folder: string;
  key: string;
  type: "archive_session";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RemoveSessionMsg".
 */
export interface RemoveSessionMsg {
  folder: string;
  key: string;
  type: "remove_session";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UserTextMsg".
 */
export interface UserTextMsg {
  interrupt?: boolean | null;
  text: string;
  type: "user_text";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SpeechStartMsg".
 */
export interface SpeechStartMsg {
  echo_risk?: boolean | null;
  type: "speech_start";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BargeInMsg".
 */
export interface BargeInMsg {
  type: "barge_in";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SpeechCancelledMsg".
 */
export interface SpeechCancelledMsg {
  type: "speech_cancelled";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UtteranceMsg".
 */
export interface UtteranceMsg {
  type: "utterance";
  wav: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "VoiceTextMsg".
 */
export interface VoiceTextMsg {
  echo_risk?: boolean | null;
  text: string;
  type: "voice_text";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeMsg".
 */
export interface HomeMsg {
  rerank?: boolean;
  type: "home";
}
/**
 * The Away recap was closed, or Home left while it showed: it goes on every page.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AwaySeenMsg".
 */
export interface AwaySeenMsg {
  type: "away_seen";
}
/**
 * Home started a queue item (by its plan key): it leaves the queue for today, the next one moves up.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanStartMsg".
 */
export interface PlanStartMsg {
  key: string;
  type: "plan_start";
}
/**
 * Later on a queue item: hidden until the next day on every page (never written to a tracker).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanLaterMsg".
 */
export interface PlanLaterMsg {
  key: string;
  type: "plan_later";
}
/**
 * Leave it on a pull request idle 14+ days ("pr:<repo>#<n>"): hidden until the PR changes (its updatedAt), never
 * written to GitHub (ticket 850).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanLeaveMsg".
 */
export interface PlanLeaveMsg {
  key: string;
  type: "plan_leave";
}
/**
 * Done on a queue task ("vikunja:<id>" or "note:<file>:<line>"): written at once; undo=True reopens the tracker's task.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanDoneMsg".
 */
export interface PlanDoneMsg {
  key: string;
  type: "plan_done";
  undo?: boolean;
}
/**
 * What the page shows now, as plain text; name None = the chat itself (nothing rides along).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ScreenMsg".
 */
export interface ScreenMsg {
  name?: string | null;
  text?: string;
  type: "screen";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskDetailMsg".
 */
export interface TaskDetailMsg {
  file: string;
  line: number;
  type: "task_detail";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemListMsg".
 */
export interface ItemListMsg {
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  type: "item_list";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemGetMsg".
 */
export interface ItemGetMsg {
  id: string;
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  type: "item_get";
}
/**
 * Archive: mark a tracker task done (done=False brings it back). The server answers with the new item_list.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemDoneMsg".
 */
export interface ItemDoneMsg {
  done?: boolean;
  id: string;
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  type: "item_done";
}
/**
 * Bulk change on tracker tasks (ids as the list shows them): `done` archives (or reopens) them, `priority` (0 to 5)
 * sets their priority. Exactly one of the two. The page confirms with a count first.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TasksBulkMsg".
 */
export interface TasksBulkMsg {
  done?: boolean | null;
  ids: string[];
  priority?: number | null;
  type: "tasks_bulk";
}
/**
 * Ask for AI-suggested priorities for the open tasks (one Haiku call, subscription only). Nothing is written to the tracker.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TasksSuggestMsg".
 */
export interface TasksSuggestMsg {
  type: "tasks_suggest";
}
/**
 * Bulk verdict on notes: approve, reject, or restore (waits again). The page confirms with a count first; the
 * vault write module writes only if every note's verdict still reads as `seen`, then the server answers with the new list.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "NotesVerdictMsg".
 */
export interface NotesVerdictMsg {
  notes: SeenNote[];
  type: "notes_verdict";
  verdict: "approve" | "reject" | "restore";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SeenNote".
 */
export interface SeenNote {
  file: string;
  seen?: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainListMsg".
 */
export interface BrainListMsg {
  type: "brain_list";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainExpiredMsg".
 */
export interface BrainExpiredMsg {
  type: "brain_expired";
}
/**
 * Brain's No topic rows. `files`: rows this page acted on (kept, dropped), listed again with their state though
 * they no longer count.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainNoTopicMsg".
 */
export interface BrainNoTopicMsg {
  files?: string[];
  type: "brain_notopic";
}
/**
 * Keep a No-topic capture as an idea: owner_read is set, only if it still reads `seen` ("").
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainKeepMsg".
 */
export interface BrainKeepMsg {
  file: string;
  seen?: string;
  type: "brain_keep";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainGetMsg".
 */
export interface BrainGetMsg {
  file: string;
  type: "brain_get";
}
/**
 * Verdicts on Brain's list, one per note (accepting a suggestion, Apply suggestions, Restore). Each goes through the
 * vault write module on its own: a refused note doesn't stop the others. The server answers with brain_applied, then
 * the list.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainApplyMsg".
 */
export interface BrainApplyMsg {
  notes: VerdictNote[];
  type: "brain_apply";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "VerdictNote".
 */
export interface VerdictNote {
  file: string;
  seen?: string;
  verdict: "approve" | "reject" | "restore";
}
/**
 * A verdict on the open note: approve, reject, or restore (waits again). Written only if the note's verdict still
 * reads `seen`; the server answers with the note and the list.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainVerdictMsg".
 */
export interface BrainVerdictMsg {
  file: string;
  seen?: string;
  type: "brain_verdict";
  verdict: "approve" | "reject" | "restore";
}
/**
 * The owner left an open note without a verdict: owner_read is set once, if it still reads `seen` ("").
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainReadMsg".
 */
export interface BrainReadMsg {
  file: string;
  seen?: string;
  type: "brain_read";
}
/**
 * Start in Orb: a new session in the item's repo (found by the server), first request = the brief.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemStartMsg".
 */
export interface ItemStartMsg {
  id: string;
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  type: "item_start";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskActionMsg".
 */
export interface TaskActionMsg {
  action: "done" | "drop" | "snooze" | "restore";
  expect: string;
  file: string;
  line: number;
  type: "task_action";
  until?: string | null;
  value?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "InterruptMsg".
 */
export interface InterruptMsg {
  type: "interrupt";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlaybackMsg".
 */
export interface PlaybackMsg {
  play_ms: number;
  turn: string;
  type: "playback";
  vad_ms: number;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PermissionMsg".
 */
export interface PermissionMsg {
  allow: boolean;
  answers?: {
    [k: string]: unknown;
  } | null;
  id: string;
  type: "permission";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ReadAllMsg".
 */
export interface ReadAllMsg {
  text: string;
  type: "read_all";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DictateNoteMsg".
 */
export interface DictateNoteMsg {
  type: "dictate_note";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UndoRequestMsg".
 */
export interface UndoRequestMsg {
  type: "undo_request";
  user_id?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UndoConfirmMsg".
 */
export interface UndoConfirmMsg {
  id: string;
  ok: boolean;
  type: "undo_confirm";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "McpStatusMsg".
 */
export interface McpStatusMsg {
  type: "mcp_status";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "McpReconnectMsg".
 */
export interface McpReconnectMsg {
  name: string;
  type: "mcp_reconnect";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SetModeMsg".
 */
export interface SetModeMsg {
  mode: "default" | "auto" | "plan";
  type: "set_mode";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SetModelMsg".
 */
export interface SetModelMsg {
  model: "haiku" | "sonnet" | "opus";
  type: "set_model";
}
/**
 * Drop a delegation's grant (ADR 0005): every later tool call of that session raises a card again.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RevokeGrantMsg".
 */
export interface RevokeGrantMsg {
  session: string;
  type: "revoke_grant";
}
/**
 * Delegate on a tracker task: the server answers with the grant card. `path`: the picker's repo, for a task whose
 * project has no mapped repo (this delegation only).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegateMsg".
 */
export interface DelegateMsg {
  path?: string | null;
  task: number;
  type: "delegate";
}
/**
 * Bulk Delegate from Up next: tracker tasks with a known repo. The server answers with the first repo's card; the
 * others follow, one per repo, whatever the answer.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegateBulkMsg".
 */
export interface DelegateBulkMsg {
  tasks: number[];
  type: "delegate_bulk";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegateConfirmMsg".
 */
export interface DelegateConfirmMsg {
  id: string;
  ok: boolean;
  type: "delegate_confirm";
}
/**
 * "Make it a task" on a routine's last run, or on a No-topic capture (`capture`, its file): the server answers
 * with a card first.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskMsg".
 */
export interface MakeTaskMsg {
  capture?: string;
  routine?: string;
  type: "make_task";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskConfirmMsg".
 */
export interface MakeTaskConfirmMsg {
  id: string;
  ok: boolean;
  type: "make_task_confirm";
}
/**
 * Delete a task this server created with "Make it a task"; any other id is refused.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskUndoMsg".
 */
export interface MakeTaskUndoMsg {
  task: number;
  type: "make_task_undo";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationReviewMsg".
 */
export interface DelegationReviewMsg {
  id: string;
  type: "delegation_review";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationApplyMsg".
 */
export interface DelegationApplyMsg {
  id: string;
  type: "delegation_apply";
}
/**
 * Undo after Apply: revert the commit and reopen the task.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationRevertMsg".
 */
export interface DelegationRevertMsg {
  id: string;
  type: "delegation_revert";
}
/**
 * Discard: stop the session, drop the branch and worktree. On an applied or reverted one: dismiss the row.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationDiscardMsg".
 */
export interface DelegationDiscardMsg {
  id: string;
  type: "delegation_discard";
}
/**
 * Failed or stuck: the same session gets what went wrong as its next request (a stuck turn is stopped first).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationRetryMsg".
 */
export interface DelegationRetryMsg {
  id: string;
  type: "delegation_retry";
}
/**
 * Stopped by restart: continue the same session in the same worktree under the same grant.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationResumeMsg".
 */
export interface DelegationResumeMsg {
  id: string;
  type: "delegation_resume";
}
/**
 * The outward card (Needs you): Allow pushes the branch and opens its PR; Skip (allow false) keeps it local.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationOutwardMsg".
 */
export interface DelegationOutwardMsg {
  allow: boolean;
  id: string;
  type: "delegation_outward";
}
/**
 * Home's drop zone: one pasted link, or one file (name + base64 bytes).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DropMsg".
 */
export interface DropMsg {
  data?: string | null;
  name?: string | null;
  type: "drop";
  url?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HelloEvent".
 */
export interface HelloEvent {
  brain: boolean;
  build: string;
  drops?: string[];
  folder?: string | null;
  folders: FolderItem[];
  onboarded: boolean;
  plan?: string | null;
  profile?: "work" | "personal";
  rate_limit?: {
    [k: string]: unknown;
  } | null;
  replay?: boolean | null;
  roots: string[];
  routines: boolean;
  services: {
    [k: string]: boolean;
  };
  session?: string | null;
  stt: "browser" | "parakeet" | "whisper";
  tracker?: string;
  tts: "browser" | "kokoro";
  type: "hello";
  vault: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "FolderItem".
 */
export interface FolderItem {
  branch?: string | null;
  has_session?: boolean;
  label: string;
  last_used?: number | null;
  live?: boolean;
  mcp_failed?: number;
  path: string;
  pinned?: boolean;
  rel: string;
  remote?: string | null;
  sessions?: SessionItem[];
  status?: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SessionItem".
 */
export interface SessionItem {
  archived?: boolean;
  ask?: string | null;
  created?: number | null;
  empty: boolean;
  finished_at?: number | null;
  key: string;
  label?: string | null;
  last_used?: number | null;
  live: boolean;
  mcp_failed?: number;
  opus?: number;
  status: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "FeaturesEvent".
 */
export interface FeaturesEvent {
  brain: boolean;
  drops?: string[];
  folder?: string | null;
  onboarded: boolean;
  plan?: string | null;
  profile?: "work" | "personal";
  replay?: boolean | null;
  roots: string[];
  routines: boolean;
  session?: string | null;
  stt: "browser" | "parakeet" | "whisper";
  tracker?: string;
  tts: "browser" | "kokoro";
  type: "features";
  vault: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "FoldersEvent".
 */
export interface FoldersEvent {
  folder?: string | null;
  items: FolderItem[];
  replay?: boolean | null;
  session?: string | null;
  type: "folders";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SetupStatusEvent".
 */
export interface SetupStatusEvent {
  auth: AuthStatus;
  folder?: string | null;
  home: string;
  kokoro_install?: KokoroInstall | null;
  login_cmd: string;
  replay?: boolean | null;
  roots: RootInfo[];
  session?: string | null;
  speech: {
    [k: string]: boolean;
  };
  suggested: Suggestion[];
  type: "setup_status";
  values: {
    [k: string]: unknown;
  };
  vault?: VaultInfo | null;
  voices: Voice[];
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AuthStatus".
 */
export interface AuthStatus {
  error?: string | null;
  installed: boolean;
  loggedIn: boolean;
  method?: string | null;
  subscription?: string | null;
  subscriptionLogin?: boolean;
}
/**
 * How far VoiceMode's Kokoro is set up on this Mac, for the setup's Kokoro card (running is `speech.kokoro`).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "KokoroInstall".
 */
export interface KokoroInstall {
  autostart: boolean;
  exposed: boolean;
  installed: boolean;
  job?: KokoroJob | null;
  voicemode: boolean;
}
/**
 * The one-click Kokoro setup's progress (kokoro_setup.py).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "KokoroJob".
 */
export interface KokoroJob {
  error?: string | null;
  running: boolean;
  step: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RootInfo".
 */
export interface RootInfo {
  exists: boolean;
  path: string;
  repos: string[];
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "Suggestion".
 */
export interface Suggestion {
  path: string;
  repos: number;
}
/**
 * The notes folder as the setup shows it: where, and what Orb found in it.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "VaultInfo".
 */
export interface VaultInfo {
  exists: boolean;
  notes: number;
  open_tasks: number;
  path: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "Voice".
 */
export interface Voice {
  desc: string;
  grade?: string | null;
  id: string;
  name: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrowseEvent".
 */
export interface BrowseEvent {
  entries: BrowseEntry[];
  folder?: string | null;
  home: string;
  parent: string | null;
  path: string;
  replay?: boolean | null;
  repo: boolean;
  session?: string | null;
  truncated: boolean;
  type: "browse";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrowseEntry".
 */
export interface BrowseEntry {
  name: string;
  path: string;
  repo: boolean;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PickedEvent".
 */
export interface PickedEvent {
  cancelled?: boolean | null;
  error?: string | null;
  folder?: string | null;
  path?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "picked";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "VoiceSampleEvent".
 */
export interface VoiceSampleEvent {
  data?: string | null;
  error?: string | null;
  folder?: string | null;
  mime?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "voice_sample";
  voice: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SettingsEvent".
 */
export interface SettingsEvent {
  folder?: string | null;
  host: string;
  port: number;
  recommended: Voice[];
  replay?: boolean | null;
  session?: string | null;
  type: "settings";
  values: {
    [k: string]: unknown;
  };
  vault: string;
  vocab_seed: string[];
  vocabulary: string;
  voices: string[];
  whisper_prompt: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ErrorEvent".
 */
export interface ErrorEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "error";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "NoticeEvent".
 */
export interface NoticeEvent {
  folder?: string | null;
  level?: ("ok" | "warn" | "error") | null;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "notice";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "OpenedEvent".
 */
export interface OpenedEvent {
  branch: string | null;
  busy: boolean;
  folder?: string | null;
  info: SessionInfo;
  label: string;
  live: boolean;
  mode: string;
  model: string;
  rel: string;
  replay?: boolean | null;
  session?: string | null;
  session_id: string | null;
  speech_gen: number;
  tasks: TaskInfo[];
  type: "opened";
}
/**
 * What agent.py keeps in FolderSession.info (from Claude Code's init message, then updated).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SessionInfo".
 */
export interface SessionInfo {
  apiKeySource?: string | null;
  context?: ContextUsage | null;
  front?: string | null;
  mcp_failed?: number | null;
  mcp_total?: number | null;
  model?: string | null;
  permissionMode?: string | null;
  version?: string | null;
  [k: string]: unknown;
}
/**
 * Tokens of the last main-thread call and the model's window.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ContextUsage".
 */
export interface ContextUsage {
  used: number;
  window: number;
}
/**
 * One background task (an opus-coder run or a background shell), as agent.py keeps it.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskInfo".
 */
export interface TaskInfo {
  coder?: boolean;
  description?: string | null;
  status: string;
  summary?: string | null;
  task_id: string;
  tool_use_id?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HistoryEvent".
 */
export interface HistoryEvent {
  events: {
    [k: string]: unknown;
  }[];
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "history";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "StateEvent".
 */
export interface StateEvent {
  busy: boolean;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "state";
  value: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SessionInfoEvent".
 */
export interface SessionInfoEvent {
  apiKeySource?: string | null;
  context?: ContextUsage | null;
  folder?: string | null;
  front?: string | null;
  mcp_failed?: number | null;
  mcp_total?: number | null;
  model?: string | null;
  permissionMode?: string | null;
  replay?: boolean | null;
  session?: string | null;
  session_id?: string | null;
  type: "session_info";
  version?: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ContextEvent".
 */
export interface ContextEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "context";
  used: number;
  window: number;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskEvent".
 */
export interface TaskEvent {
  coder?: boolean;
  description?: string | null;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  status: string;
  summary?: string | null;
  task_id: string;
  tool_use_id?: string | null;
  type: "task";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "CommandsEvent".
 */
export interface CommandsEvent {
  folder?: string | null;
  items: CommandItem[];
  replay?: boolean | null;
  session?: string | null;
  type: "commands";
}
/**
 * One entry of the slash menu (slash.merge): the dashboard's own first, then Claude Code's.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "CommandItem".
 */
export interface CommandItem {
  argumentHint?: string;
  description?: string;
  local?: boolean;
  name: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "McpEvent".
 */
export interface McpEvent {
  folder?: string | null;
  open?: boolean | null;
  replay?: boolean | null;
  servers: McpServer[];
  session?: string | null;
  type: "mcp";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "McpServer".
 */
export interface McpServer {
  error?: string | null;
  name: string | null;
  status: string | null;
  tools?: number | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RateLimitEvent".
 */
export interface RateLimitEvent {
  folder?: string | null;
  overage?: {
    [k: string]: unknown;
  };
  replay?: boolean | null;
  session?: string | null;
  status?: string | null;
  type: "rate_limit";
  windows?: {
    [k: string]: UsageWindow;
  } | null;
}
/**
 * One plan window from the SDK's rate-limit info (unifiedWindows).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UsageWindow".
 */
export interface UsageWindow {
  resetsAt?: number | null;
  utilization?: number | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutinesEvent".
 */
export interface RoutinesEvent {
  checked_at: number | null;
  checking: boolean;
  error: string | null;
  folder?: string | null;
  items: RoutineItem[];
  needs: number;
  new: number;
  read: number;
  replay?: boolean | null;
  session?: string | null;
  type: "routines";
}
/**
 * One row of the Routines panel (routines.item).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutineItem".
 */
export interface RoutineItem {
  cron?: string;
  enabled: boolean;
  id: string;
  last?: RoutineRun | null;
  loud?: boolean;
  missed_at?: number | null;
  name: string;
  needs?: ("failed" | "waiting" | "stuck" | "missed" | "broken" | "action") | null;
  new?: boolean;
  next_run_at?: number | null;
  notify?: ("always" | "never") | null;
  quiet?: boolean;
  repair?: RoutineRepair | null;
  repo?: string;
  resolved?: boolean;
  security?: boolean;
  state: "failed" | "stuck" | "missed" | "needs you" | "worth reading" | "nothing to report" | "off";
  streak?: RoutineStreak | null;
  urgent?: boolean;
  why?: string;
  worth?: ("read" | "skip") | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutineRun".
 */
export interface RoutineRun {
  at?: number | null;
  detail?: string;
  ended?: number | null;
  id: string;
  outcome?: ("ok" | "failed" | "waiting" | "running" | "stuck") | null;
  summary?: string;
  url?: string;
}
/**
 * The routine's open Repair task (GLOSSARY: Repair task), as the last re-read in the tracker found it.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutineRepair".
 */
export interface RoutineRepair {
  task: number;
  url?: string | null;
}
/**
 * A failure streak (routines.streak, GLOSSARY: Failure streak).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutineStreak".
 */
export interface RoutineStreak {
  count: number;
  runs?: StreakRun[];
  since?: number | null;
}
/**
 * One counted run of a failure streak: its start and its checked claude.ai link.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "StreakRun".
 */
export interface StreakRun {
  at?: number | null;
  url: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BgNoticeEvent".
 */
export interface BgNoticeEvent {
  data?: string | null;
  folder?: string | null;
  kind: string;
  label?: string | null;
  mime?: string | null;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "bg_notice";
}
/**
 * open_screen: the pages showing the asking session go to a destination, or one item there (set fields only).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "NavigateEvent".
 */
export interface NavigateEvent {
  destination: "home" | "sessions" | "brain" | "tasks" | "routines" | "settings";
  folder: string | null;
  note: string | null;
  replay?: boolean | null;
  routine: string | null;
  running: boolean;
  session: string | null;
  task: string | null;
  type: "navigate";
}
/**
 * The home screen's notes part (home.summary): open tasks and recent notes in the vault.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeEvent".
 */
export interface HomeEvent {
  awaiting?: HomeAwait[];
  awaiting_count?: number;
  folder?: string | null;
  notes: HomeNote[];
  notes_week: number;
  notopic_count?: number;
  open_tasks: number;
  replay?: boolean | null;
  session?: string | null;
  snoozed: number;
  tasks: HomeTask[];
  type: "home";
  vault: string;
}
/**
 * A note waiting for the owner's verdict (fact-checked with no human_verdict, or AI-curated and unreviewed).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeAwait".
 */
export interface HomeAwait {
  file: string;
  lane?: string;
  mtime: number;
  published?: string;
  score?: number | null;
  tag: string;
  title: string;
  topic?: string;
  verified?: number | null;
  why?: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeNote".
 */
export interface HomeNote {
  file: string;
  mtime: number;
  title: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeTask".
 */
export interface HomeTask {
  file: string;
  line: number;
  mtime: number;
  raw: string;
  text: string;
}
/**
 * Home's Don't forget pane (forget.summary): reminders, unsaved repos, open PRs; and the pinned links.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeForgetEvent".
 */
export interface HomeForgetEvent {
  folder?: string | null;
  links: PinnedLink[];
  prs: OpenPr[];
  reminders: Reminder[];
  replay?: boolean | null;
  repos: DirtyRepo[];
  session?: string | null;
  type: "home_forget";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PinnedLink".
 */
export interface PinnedLink {
  label: string;
  url: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "OpenPr".
 */
export interface OpenPr {
  draft: boolean;
  idle_days: number;
  number: number;
  repo: string;
  stale: boolean;
  title: string;
  updated: number;
  url: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "Reminder".
 */
export interface Reminder {
  days?: number | null;
  due?: string | null;
  text: string;
  url?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DirtyRepo".
 */
export interface DirtyRepo {
  ahead?: number | null;
  behind?: number;
  branch?: string | null;
  changed: number;
  label: string;
  path: string;
}
/**
 * Home's view of the Tasks source (tracker.home_event): the first open tasks and the count, or why the tracker
 * can't be read. `tasks` is None when no tracker is set up (Home counts the notes' tasks instead).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeTasksEvent".
 */
export interface HomeTasksEvent {
  error?: string | null;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  tasks: TrackerTask[] | null;
  total: number;
  type: "home_tasks";
  url?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TrackerTask".
 */
export interface TrackerTask {
  created?: string;
  due?: string | null;
  id: number;
  labels?: string[];
  priority: number;
  project: string;
  project_id?: number;
  title: string;
  updated: number;
  url: string;
}
/**
 * Home's Away recap (away.Clock): the one-shot card after 24 hours or more without the owner acting, or None.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AwayRecapEvent".
 */
export interface AwayRecapEvent {
  folder?: string | null;
  recap: AwayRecap | null;
  replay?: boolean | null;
  session?: string | null;
  type: "away_recap";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AwayRecap".
 */
export interface AwayRecap {
  back?: number | null;
  heading: string;
  lines?: AwayLine[];
  more?: number;
  since: number;
}
/**
 * One thing that finished without the owner: a routine's latest ok Run (count: its Runs since they left), the
 * vault's "3 pages expired" (opens Brain's Expired view), or Orb's own "2 sessions finished" (opens Sessions) /
 * "1 delegation Ready" (opens the Delegated strip) / "4 old sessions archived" (opens Sessions); count: how many.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AwayLine".
 */
export interface AwayLine {
  count?: number;
  id: string;
  kind: "routine" | "expired" | "finished" | "ready" | "archived";
  summary?: string;
  title: string;
}
/**
 * Home's plan. needs_you is decided by rules (docs/adr/0001): a broken setup, routines with a problem, reminders
 * due today or earlier, then tasks due before today; approvals sit above it on the page. The queue (next, then up_next) is the rest worth doing. A model may
 * only reorder both and give reasons.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanEvent".
 */
export interface PlanEvent {
  busy?: boolean;
  error?: string | null;
  folder?: string | null;
  needs_you: PlanItem[];
  next?: PlanItem | null;
  ranked_at?: number | null;
  replay?: boolean | null;
  session?: string | null;
  stale?: boolean;
  type: "plan";
  up_next?: PlanItem[];
}
/**
 * One row of Home's plan (needs.py). title is ours; reason is the rule's, or the model's while that item's facts are
 * unchanged (plain text, from untrusted data).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PlanItem".
 */
export interface PlanItem {
  actions?: ("open" | "start" | "done" | "later" | "delegate" | "make_task" | "leave")[];
  due?: string | null;
  id: string;
  key: string;
  kind:
    | "approval"
    | "setup"
    | "vault"
    | "routine"
    | "reminder"
    | "task"
    | "note_task"
    | "result"
    | "pr"
    | "notes_batch"
    | "notopic"
    | "results_old";
  pin?: ("security" | "client" | "money") | null;
  priority?: number | null;
  reason: string;
  repair?: number | null;
  repo?: string | null;
  source?: string | null;
  suggest?: ("take now" | "delegate" | "later") | null;
  title: string;
  urgent?: boolean;
  url?: string | null;
}
/**
 * One task in its note (tasks.detail): the line, the note's title and heading, the lines around it.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskDetailEvent".
 */
export interface TaskDetailEvent {
  context: TaskLine[];
  file: string;
  folder?: string | null;
  heading: string;
  line: number;
  mtime: number;
  raw: string;
  replay?: boolean | null;
  session?: string | null;
  title: string;
  type: "task_detail";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskLine".
 */
export interface TaskLine {
  n: number;
  text: string;
}
/**
 * One item in full (items.get): chips, plain-text body, the repo it maps to (label, None = no repo), the prompt to copy.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemEvent".
 */
export interface ItemEvent {
  body: string;
  brief: string;
  can_archive?: boolean;
  chips: string[];
  done?: boolean;
  folder?: string | null;
  id: string;
  kicker: string;
  replay?: boolean | null;
  repo?: string | null;
  session?: string | null;
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  title: string;
  type: "item";
  url?: string | null;
  url_label?: string | null;
}
/**
 * One table (items.list_): its columns and rows. `group_key` is the column to group by ("repo" = the Repo column).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemListEvent".
 */
export interface ItemListEvent {
  busy?: boolean;
  can_archive?: boolean;
  can_judge?: boolean;
  can_suggest?: boolean;
  columns: ItemColumn[];
  error?: string | null;
  folder?: string | null;
  group_key?: string | null;
  heading: string;
  kicker: string;
  replay?: boolean | null;
  rows: ItemRow[];
  session?: string | null;
  source: "vikunja" | "prs" | "repos" | "notes" | "tasks";
  status_default?: string;
  statuses?: string[];
  type: "item_list";
  url?: string | null;
  url_label?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemColumn".
 */
export interface ItemColumn {
  key: string;
  kind?: "title" | "repo" | "text" | "chip" | "due" | "priority" | "num" | "age";
  label: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ItemRow".
 */
export interface ItemRow {
  cells: {
    [k: string]: string;
  };
  hot?: boolean;
  id: string;
  repo?: string | null;
  status?: string;
  title: string;
}
/**
 * Brain's list: the newest notes, newest first. `error` when there is no notes folder.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainListEvent".
 */
export interface BrainListEvent {
  error?: string | null;
  folder?: string | null;
  notes: BrainNote[];
  replay?: boolean | null;
  session?: string | null;
  type: "brain_list";
}
/**
 * One note on Brain's list (home.brain_notes).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainNote".
 */
export interface BrainNote {
  expires?: string;
  file: string;
  kind: string;
  lane: string;
  mtime: number;
  owner_read: string;
  score: number | null;
  suggest?: "approve" | "reject" | "";
  title: string;
  verdict: string;
  waiting: boolean;
  why: string;
}
/**
 * Brain's Expired view (home.expired_notes): pages the vault archived in the last 30 days, newest first. Read
 * only: Orb never writes `auto_archived`; Keep is the approve verdict. `error` when there is no notes folder.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainExpiredEvent".
 */
export interface BrainExpiredEvent {
  error?: string | null;
  folder?: string | null;
  notes: ExpiredNote[];
  replay?: boolean | null;
  session?: string | null;
  type: "brain_expired";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ExpiredNote".
 */
export interface ExpiredNote {
  archived: string;
  expires?: string;
  file: string;
  kind: string;
  lane: string;
  mtime: number;
  owner_read: string;
  score: number | null;
  suggest?: "approve" | "reject" | "";
  title: string;
  verdict: string;
  waiting: boolean;
  why: string;
}
/**
 * Brain's No topic view (home.notopic_notes): No-topic captures, oldest first, plus the rows this page asked for
 * again (`files`) with their new state. `error` when there is no notes folder.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainNoTopicEvent".
 */
export interface BrainNoTopicEvent {
  error?: string | null;
  folder?: string | null;
  notes: NoTopicNote[];
  replay?: boolean | null;
  session?: string | null;
  type: "brain_notopic";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "NoTopicNote".
 */
export interface NoTopicNote {
  capture?: string;
  created: string;
  expires?: string;
  file: string;
  kind: string;
  lane: string;
  mtime: number;
  owner_read: string;
  score: number | null;
  suggest?: "approve" | "reject" | "";
  title: string;
  verdict: string;
  waiting: boolean;
  why: string;
}
/**
 * One note's page: the list fields and the body under the frontmatter, as plain text.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainNoteEvent".
 */
export interface BrainNoteEvent {
  body: string;
  expires?: string;
  file: string;
  folder?: string | null;
  kind: string;
  lane: string;
  mtime: number;
  owner_read: string;
  replay?: boolean | null;
  score: number | null;
  session?: string | null;
  suggest?: "approve" | "reject" | "";
  title: string;
  type: "brain_note";
  verdict: string;
  waiting: boolean;
  why: string;
}
/**
 * The answer to brain_apply, before the new list: what was written (each with the verdict asked for) and what the
 * vault write module refused, with its reason.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainAppliedEvent".
 */
export interface BrainAppliedEvent {
  applied: BrainApplied[];
  folder?: string | null;
  refused: BrainRefused[];
  replay?: boolean | null;
  session?: string | null;
  type: "brain_applied";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainApplied".
 */
export interface BrainApplied {
  file: string;
  verdict: "approve" | "reject" | "restore" | "keep";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "BrainRefused".
 */
export interface BrainRefused {
  file: string;
  reason: string;
}
/**
 * A task line was rewritten (tasks.act); `previous` is what Undo puts back.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TaskChangedEvent".
 */
export interface TaskChangedEvent {
  action: "done" | "drop" | "snooze" | "restore";
  file: string;
  folder?: string | null;
  line: number;
  previous: string;
  raw: string;
  replay?: boolean | null;
  session?: string | null;
  type: "task_changed";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UserEvent".
 */
export interface UserEvent {
  folder?: string | null;
  id?: string | null;
  replay?: boolean | null;
  screen?: string | null;
  session?: string | null;
  source: string;
  text: string;
  type: "user";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TextStartEvent".
 */
export interface TextStartEvent {
  block: string;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "text_start";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TextEvent".
 */
export interface TextEvent {
  block: string;
  delta: string;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "text";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SaidEvent".
 */
export interface SaidEvent {
  block: string;
  delta: string;
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "said";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ToolStartEvent".
 */
export interface ToolStartEvent {
  block?: {
    [k: string]: unknown;
  };
  folder?: string | null;
  id: string | null;
  name: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "tool_start";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ToolInputEvent".
 */
export interface ToolInputEvent {
  folder?: string | null;
  id: string | null;
  input: {
    [k: string]: unknown;
  };
  name: string | null;
  parent?: string | null;
  replay?: boolean | null;
  session?: string | null;
  summary: string;
  type: "tool_input";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ToolResultEvent".
 */
export interface ToolResultEvent {
  content: string;
  folder?: string | null;
  is_error: boolean;
  parent?: string | null;
  replay?: boolean | null;
  session?: string | null;
  tool_use_id: string | null;
  truncated: boolean;
  type: "tool_result";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "ResultEvent".
 */
export interface ResultEvent {
  duration_ms?: number | null;
  folder?: string | null;
  is_error?: boolean | null;
  num_turns?: number | null;
  replay?: boolean | null;
  session?: string | null;
  session_id?: string | null;
  stop_reason?: string | null;
  subtype?: string | null;
  type: "result";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "TimingEvent".
 */
export interface TimingEvent {
  folder?: string | null;
  hops: {
    [k: string]: unknown;
  };
  model: string | null;
  replay?: boolean | null;
  session?: string | null;
  source: string;
  turn: string;
  type: "timing";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PartialEvent".
 */
export interface PartialEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "partial";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HeardNothingEvent".
 */
export interface HeardNothingEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "heard_nothing";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PinFocusedEvent".
 */
export interface PinFocusedEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "pin_focused";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HeldEvent".
 */
export interface HeldEvent {
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "held";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PermissionEvent".
 */
export interface PermissionEvent {
  blocked_path?: string | null;
  description?: string | null;
  folder?: string | null;
  id: string;
  input: {
    [k: string]: unknown;
  };
  replay?: boolean | null;
  session?: string | null;
  summary: string;
  title?: string | null;
  tool: string;
  tool_use_id?: string | null;
  type: "permission";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "PermissionDoneEvent".
 */
export interface PermissionDoneEvent {
  allow: boolean;
  answers?: {
    [k: string]: unknown;
  } | null;
  folder?: string | null;
  heard?: string | null;
  id: string;
  replay?: boolean | null;
  session?: string | null;
  type: "permission_done";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UndoAvailableEvent".
 */
export interface UndoAvailableEvent {
  files: string[];
  folder?: string | null;
  replay?: boolean | null;
  session?: string | null;
  type: "undo_available";
  user_id: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UndoConfirmEvent".
 */
export interface UndoConfirmEvent {
  _created?: {
    [k: string]: unknown;
  };
  _later?: {
    [k: string]: unknown;
  };
  files: string[];
  folder?: string | null;
  id: string;
  note: string;
  replay?: boolean | null;
  session?: string | null;
  type: "undo_confirm";
  user_id: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "UndoDoneEvent".
 */
export interface UndoDoneEvent {
  error?: string | null;
  files?: string[] | null;
  folder?: string | null;
  heard?: string | null;
  id: string;
  ok: boolean;
  replay?: boolean | null;
  session?: string | null;
  type: "undo_done";
  user_id?: string | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "AudioEvent".
 */
export interface AudioEvent {
  data?: string | null;
  folder?: string | null;
  gen: number;
  mime?: string | null;
  replay?: boolean | null;
  seq: number;
  session?: string | null;
  speak?: boolean | null;
  text: string;
  type: "audio";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "SpeechResetEvent".
 */
export interface SpeechResetEvent {
  folder?: string | null;
  gen: number;
  replay?: boolean | null;
  session?: string | null;
  type: "speech_reset";
}
/**
 * Delegate's grant card (ADR 0005): the repo, the branch and what the session may do without asking. A bulk
 * Delegate has one card per repo: `rows` are its tasks (task/title/branch are the first), `more` the repos still to
 * ask about after this one.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegateCardEvent".
 */
export interface DelegateCardEvent {
  branch: string;
  covers: string[];
  folder?: string | null;
  id: string;
  more?: number;
  replay?: boolean | null;
  repo: string;
  rows?: DelegateCardRow[];
  session?: string | null;
  task: number;
  title: string;
  type: "delegate_card";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegateCardRow".
 */
export interface DelegateCardRow {
  branch: string;
  task: number;
  title: string;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationsEvent".
 */
export interface DelegationsEvent {
  folder?: string | null;
  items: DelegationItem[];
  replay?: boolean | null;
  session?: string | null;
  type: "delegations";
}
/**
 * One row of the Delegated strip, in the order they were delegated. `line` is the stage in plain words.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationItem".
 */
export interface DelegationItem {
  apply_text: string;
  ask?: string | null;
  branch: string;
  conflict?: string | null;
  folder: string;
  id: string;
  line: string;
  needs?: ("card" | "failed" | "stuck" | "stopped" | "outward") | null;
  pr?: number | null;
  pr_url?: string | null;
  repo: string;
  session: string;
  stage: "queued" | "working" | "testing" | "pushing" | "ready" | "failed" | "applied" | "reverted" | "stopped";
  task: number;
  title: string;
}
/**
 * Review: the delegation's own work (snapshot..branch), stat then patch, capped.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DelegationDiffEvent".
 */
export interface DelegationDiffEvent {
  branch: string;
  diff: string;
  folder?: string | null;
  id: string;
  replay?: boolean | null;
  session?: string | null;
  type: "delegation_diff";
}
/**
 * "Make it a task": the card to allow or deny before Orb creates a task in the tracker (ADR 0008, 0010).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskCardEvent".
 */
export interface MakeTaskCardEvent {
  capture?: string;
  folder?: string | null;
  id: string;
  project: string;
  replay?: boolean | null;
  routine?: string;
  session?: string | null;
  title: string;
  type: "make_task_card";
}
/**
 * The card's outcome: created (`task`, `url`), denied (ok false, no error) or failed (`error`).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskDoneEvent".
 */
export interface MakeTaskDoneEvent {
  capture?: string | null;
  error?: string | null;
  folder?: string | null;
  id: string;
  ok: boolean;
  project?: string | null;
  replay?: boolean | null;
  session?: string | null;
  task?: number | null;
  title?: string | null;
  type: "make_task_done";
  url?: string | null;
}
/**
 * Undo of a created task: deleted (and a capture's owner_read taken off again), or why not.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "MakeTaskUndoneEvent".
 */
export interface MakeTaskUndoneEvent {
  capture?: string | null;
  error?: string | null;
  folder?: string | null;
  ok: boolean;
  replay?: boolean | null;
  session?: string | null;
  task: number;
  type: "make_task_undone";
}
/**
 * A drop on Home, routed and running in the background (intake.py, ADR 0009); refused: why.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DropRoutedEvent".
 */
export interface DropRoutedEvent {
  folder?: string | null;
  id?: string | null;
  ok: boolean;
  replay?: boolean | null;
  route?: string | null;
  session?: string | null;
  text: string;
  type: "drop_routed";
}
/**
 * A drop ended (every page): a job's "Saved: <title>" and the note it wrote, a session's first turn ("Saved",
 * "Answered"), or why it failed.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "DropDoneEvent".
 */
export interface DropDoneEvent {
  folder?: string | null;
  id: string;
  note?: string | null;
  ok: boolean;
  replay?: boolean | null;
  session?: string | null;
  text: string;
  type: "drop_done";
}
/**
 * What this install has turned on, and how Claude Code is signed in (plan only).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "Features".
 */
export interface Features {
  brain: boolean;
  drops?: string[];
  onboarded: boolean;
  plan?: string | null;
  profile?: "work" | "personal";
  roots: string[];
  routines: boolean;
  stt: "browser" | "parakeet" | "whisper";
  tracker?: string;
  tts: "browser" | "kokoro";
  vault: string;
}
