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
    last_used: float | None = None
    empty: bool
    status: str
    live: bool
    mcp_failed: int = 0
    opus: int = 0


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


class SetupStatusEvent(_Event):
    type: Literal["setup_status"]
    auth: AuthStatus
    login_cmd: str
    roots: list[RootInfo]
    suggested: list[Suggestion]
    home: str
    speech: dict[str, bool]
    voices: list[Voice]
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
    url: str = ""


class RoutineItem(_Msg):
    """One row of the Routines panel (routines.item)."""
    id: str
    name: str
    enabled: bool
    cron: str = ""
    next_run_at: float | None = None
    last: RoutineRun | None = None
    needs: Literal["failed", "waiting", "stuck", "missed"] | None = None
    new: bool = False


class RoutinesEvent(_Event):
    type: Literal["routines"]
    items: list[RoutineItem]
    checked_at: float | None
    checking: bool
    error: str | None
    needs: int
    new: int


class BgNoticeEvent(_Event):
    type: Literal["bg_notice"]
    kind: str
    text: str
    label: str | None = None
    data: str | None = None
    mime: str | None = None


class HomeTask(_Msg):
    text: str
    file: str  # relative to the vault
    line: int
    mtime: float


class HomeNote(_Msg):
    title: str
    file: str
    mtime: float


class HomeEvent(_Event):
    """The home screen's notes part (home.summary): open tasks and recent notes in the vault."""
    type: Literal["home"]
    vault: str
    tasks: list[HomeTask]
    open_tasks: int
    notes: list[HomeNote]
    notes_week: int


class UserEvent(_Event):
    type: Literal["user"]
    text: str
    source: str
    id: str | None = None


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


ServerEvent = Annotated[Union[
    HelloEvent, FeaturesEvent, FoldersEvent, SetupStatusEvent, BrowseEvent, PickedEvent, VoiceSampleEvent,
    SettingsEvent, ErrorEvent, NoticeEvent, OpenedEvent, HistoryEvent, StateEvent, SessionInfoEvent,
    ContextEvent, TaskEvent, CommandsEvent, McpEvent, RateLimitEvent, RoutinesEvent, BgNoticeEvent,
    HomeEvent, UserEvent, TextStartEvent, TextEvent, SaidEvent, ToolStartEvent, ToolInputEvent, ToolResultEvent,
    ResultEvent, TimingEvent, PartialEvent, HeardNothingEvent, HeldEvent, PermissionEvent,
    PermissionDoneEvent, UndoAvailableEvent, UndoConfirmEvent, UndoDoneEvent, AudioEvent, SpeechResetEvent,
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


class RescanMsg(_Msg):
    type: Literal["rescan"]


class RoutinesMsg(_Msg):
    type: Literal["routines"]
    refresh: bool | None = None


class RoutinesSeenMsg(_Msg):
    type: Literal["routines_seen"]


class MuteMsg(_Msg):
    type: Literal["mute"]
    value: bool


class NewSessionMsg(_Msg):
    type: Literal["new_session"]


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
    model: Literal["sonnet", "opus"]


ClientMessage = Annotated[Union[
    SetupStatusMsg, BrowseMsg, PickFolderMsg, OpenFolderMsg, AddFolderMsg, StartSessionMsg, PinFolderMsg,
    GetSettingsMsg, SetSettingsMsg, VoiceSampleMsg, RescanMsg, RoutinesMsg, RoutinesSeenMsg, MuteMsg,
    NewSessionMsg, UserTextMsg, SpeechStartMsg, BargeInMsg, SpeechCancelledMsg, UtteranceMsg, VoiceTextMsg,
    HomeMsg, InterruptMsg, PlaybackMsg, PermissionMsg, ReadAllMsg, DictateNoteMsg, UndoRequestMsg, UndoConfirmMsg,
    McpStatusMsg, McpReconnectMsg, SetModeMsg, SetModelMsg,
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
