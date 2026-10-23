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
  | RescanMsg
  | RoutinesMsg
  | RoutinesSeenMsg
  | MuteMsg
  | NewSessionMsg
  | UserTextMsg
  | SpeechStartMsg
  | BargeInMsg
  | SpeechCancelledMsg
  | UtteranceMsg
  | VoiceTextMsg
  | HomeMsg
  | TaskDetailMsg
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
  | SetModelMsg;
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
  | HomeEvent
  | TaskDetailEvent
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
  | HeldEvent
  | PermissionEvent
  | PermissionDoneEvent
  | UndoAvailableEvent
  | UndoConfirmEvent
  | UndoDoneEvent
  | AudioEvent
  | SpeechResetEvent;

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
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutinesSeenMsg".
 */
export interface RoutinesSeenMsg {
  type: "routines_seen";
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
  type: "home";
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
  model: "sonnet" | "opus";
  type: "set_model";
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HelloEvent".
 */
export interface HelloEvent {
  brain: boolean;
  build: string;
  folder?: string | null;
  folders: FolderItem[];
  onboarded: boolean;
  plan?: string | null;
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
  empty: boolean;
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
  folder?: string | null;
  onboarded: boolean;
  plan?: string | null;
  replay?: boolean | null;
  roots: string[];
  routines: boolean;
  session?: string | null;
  stt: "browser" | "parakeet" | "whisper";
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
  name: string;
  needs?: ("failed" | "waiting" | "stuck" | "missed") | null;
  new?: boolean;
  next_run_at?: number | null;
}
/**
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "RoutineRun".
 */
export interface RoutineRun {
  at?: number | null;
  ended?: number | null;
  id: string;
  outcome?: ("ok" | "failed" | "waiting" | "running" | "stuck") | null;
  summary?: string;
  url?: string;
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
 * The home screen's notes part (home.summary): open tasks and recent notes in the vault.
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "HomeEvent".
 */
export interface HomeEvent {
  folder?: string | null;
  notes: HomeNote[];
  notes_week: number;
  open_tasks: number;
  replay?: boolean | null;
  session?: string | null;
  snoozed: number;
  tasks: HomeTask[];
  type: "home";
  vault: string;
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
 * What this install has turned on, and how Claude Code is signed in (plan only).
 *
 * This interface was referenced by `OrbProtocol`'s JSON-Schema
 * via the `definition` "Features".
 */
export interface Features {
  brain: boolean;
  onboarded: boolean;
  plan?: string | null;
  roots: string[];
  routines: boolean;
  stt: "browser" | "parakeet" | "whisper";
  tts: "browser" | "kokoro";
  vault: string;
}
