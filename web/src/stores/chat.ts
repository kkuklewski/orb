// The open session's conversation as plain data: user messages, answers (text blocks with their
// spoken line, tool steps, approval / plan / question / undo cards, background tasks), notices.
// One pure reducer turns server events into it; history replays through the same reducer.
import { create } from "zustand";
import type {
  OpenedEvent, PermissionDoneEvent, PermissionEvent, ServerEvent, TaskInfo, UndoConfirmEvent, UndoDoneEvent,
} from "../protocol.gen";
import { on } from "../events";
import { useSession } from "./session";

export interface ToolRow { id: string; name: string; input: Record<string, unknown>; summary: string; pending: boolean; error: boolean; out: string | null }
export type Part =
  | { kind: "text"; id: string; text: string; said: string }
  | { kind: "tools"; rows: ToolRow[]; running: boolean }
  | { kind: "perm"; ev: PermissionEvent; done: PermissionDoneEvent | null }
  | { kind: "undo"; ev: UndoConfirmEvent; done: UndoDoneEvent | null }
  | { kind: "held"; text: string }
  | { kind: "task"; task: TaskInfo };
export interface Answer { kind: "answer"; key: number; userId: string | null; parts: Part[]; done: boolean; undoFiles: string[] | null; undone: boolean; timing: string | null }
export type Item =
  | { kind: "user"; key: number; id: string | null; text: string; source: string }
  | Answer
  | { kind: "notice"; key: number; text: string; level: "ok" | "warn" | "error" | null }
  | { kind: "end"; key: number; text: string };

export interface ChatState {
  items: Item[];
  answer: number | null; // index of the answer being written
  toolsOpen: boolean; // the answer's last part is a tool group that takes new steps
  lastUser: string | null;
  replaying: boolean;
  openTasks: TaskInfo[]; // from "opened": running ones are shown after the history replay
  seq: number;
}

export const initialChat = (): ChatState => ({ items: [], answer: null, toolsOpen: false, lastUser: null, replaying: false, openTasks: [], seq: 0 });

// -- small immutable helpers ---------------------------------------------------------------------

const copy = (s: ChatState): ChatState => ({ ...s, items: s.items.slice() });

function ensureAnswer(s: ChatState, userId: string | null = s.lastUser): Answer {
  if (s.answer === null) {
    s.items.push({ kind: "answer", key: s.seq++, userId, parts: [], done: false, undoFiles: null, undone: false, timing: null });
    s.answer = s.items.length - 1;
    s.toolsOpen = false;
  }
  const a = { ...(s.items[s.answer] as Answer) };
  a.parts = a.parts.slice();
  s.items[s.answer] = a;
  return a;
}

/** Find a part anywhere (newest first) and replace it; returns false when it isn't there. */
function updatePart(s: ChatState, match: (p: Part) => boolean, change: (p: Part, a: Answer) => Part): boolean {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    if (it.kind !== "answer") continue;
    const j = it.parts.findIndex(match);
    if (j < 0) continue;
    const a = { ...it, parts: it.parts.slice() };
    a.parts[j] = change(a.parts[j], a);
    s.items[i] = a;
    return true;
  }
  return false;
}

function updateAnswer(s: ChatState, userId: string | null | undefined, change: (a: Answer) => Answer): void {
  if (!userId) return;
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    if (it.kind === "answer" && it.userId === userId) { s.items[i] = change(it); return; }
  }
}

const hasRow = (id: string) => (p: Part) => p.kind === "tools" && p.rows.some((r) => r.id === id);

function updateRow(s: ChatState, id: string, change: (r: ToolRow) => ToolRow): boolean {
  return updatePart(s, hasRow(id), (p) => (p.kind === "tools" ? { ...p, rows: p.rows.map((r) => (r.id === id ? change(r) : r)) } : p));
}

/** Put a part just before (or after) the tool group holding `toolUseId` in the open answer, else at the end. */
function place(a: Answer, part: Part, toolUseId: string | null | undefined, after = false) {
  const j = toolUseId ? a.parts.findIndex(hasRow(toolUseId)) : -1;
  if (j < 0) a.parts.push(part);
  else a.parts.splice(after ? j + 1 : j, 0, part);
}

/** The answer is complete: steps stop pulsing, and a block that was only a spoken line becomes its text. */
function finish(s: ChatState) {
  if (s.answer === null) return;
  const a = s.items[s.answer] as Answer;
  s.items[s.answer] = {
    ...a, done: true,
    parts: a.parts.map((p) => p.kind === "tools" ? { ...p, running: false, rows: p.rows.map((r) => ({ ...r, pending: false })) }
      : p.kind === "text" && !p.text.trim() && p.said.trim() ? { ...p, text: p.said.trim(), said: "" } : p),
  };
  s.answer = null;
  s.toolsOpen = false;
}

function textPart(s: ChatState, block: string): void {
  const a = ensureAnswer(s);
  if (!a.parts.some((p) => p.kind === "text" && p.id === block)) {
    a.parts.push({ kind: "text", id: block, text: "", said: "" });
    s.toolsOpen = false;
  }
}

function timingLine(model: string | null | undefined, hops: Record<string, unknown>): string {
  const ORDER = ["vad", "stt", "hold", "conn", "ttft", "say", "tts", "net", "total", "turn"];
  return [model?.replace(/^claude-/, ""), ...ORDER.filter((k) => typeof hops[k] === "number").map((k) => `${k} ${((hops[k] as number) / 1000).toFixed(1)}`)]
    .filter(Boolean).join(" · ");
}

// -- reducer -------------------------------------------------------------------------------------

/** Pure: the next conversation for one event (the caller has already dropped other sessions' events). */
export function reduce(state: ChatState, ev: ServerEvent): ChatState {
  const s = copy(state);
  switch (ev.type) {
    case "opened":
      return { ...state, openTasks: (ev as OpenedEvent).tasks };
    case "history": {
      let r: ChatState = { ...initialChat(), openTasks: state.openTasks, replaying: true };
      for (const e of ev.events as unknown as ServerEvent[]) r = reduce(r, e);
      for (const t of r.openTasks) if (t.status === "running") r = reduce({ ...r, replaying: false }, { type: "task", ...t });
      r = copy(r); finish(r);
      return { ...r, replaying: false };
    }
    case "user":
      finish(s);
      s.items.push({ kind: "user", key: s.seq++, id: ev.id ?? null, text: ev.text, source: ev.source });
      s.lastUser = ev.id ?? null;
      return s;
    case "text_start":
      textPart(s, ev.block);
      return s;
    case "text":
    case "said": {
      textPart(s, ev.block);
      const field = ev.type === "text" ? "text" : "said";
      updatePart(s, (p) => p.kind === "text" && p.id === ev.block, (p) => (p.kind === "text" ? { ...p, [field]: p[field] + ev.delta } : p));
      return s;
    }
    case "held":
      ensureAnswer(s).parts.push({ kind: "held", text: ev.text });
      return s;
    case "tool_start":
    case "tool_input": {
      const id = ev.id ?? "";
      const input = ev.type === "tool_input" ? (ev.input as Record<string, unknown>) : undefined;
      const summary = ev.type === "tool_input" ? ev.summary : undefined;
      if (updateRow(s, id, (r) => ({ ...r, name: ev.name ?? r.name, input: input ?? r.input, summary: summary ?? r.summary }))) return s;
      const a = ensureAnswer(s);
      const row: ToolRow = { id, name: ev.name ?? "tool", input: input ?? {}, summary: summary ?? ev.name ?? "tool", pending: true, error: false, out: null };
      const last = a.parts[a.parts.length - 1];
      if (s.toolsOpen && last?.kind === "tools") a.parts[a.parts.length - 1] = { ...last, rows: [...last.rows, row] };
      else { a.parts.push({ kind: "tools", rows: [row], running: !s.replaying }); s.toolsOpen = true; }
      return s;
    }
    case "tool_result":
      updateRow(s, ev.tool_use_id ?? "", (r) => ({ ...r, pending: false, error: ev.is_error, out: (ev.content || "(no output)") + (ev.truncated ? "\n… (truncated)" : "") }));
      return s;
    case "permission": {
      if (s.items.some((it) => it.kind === "answer" && it.parts.some((p) => p.kind === "perm" && p.ev.id === ev.id))) return state;
      const a = ensureAnswer(s);
      place(a, { kind: "perm", ev, done: null }, ev.tool_use_id);
      s.toolsOpen = false;
      return s;
    }
    case "permission_done":
      updatePart(s, (p) => p.kind === "perm" && p.ev.id === ev.id && !p.done, (p) => ({ ...p, done: ev }) as Part);
      return s;
    case "undo_available":
      updateAnswer(s, ev.user_id, (a) => ({ ...a, undoFiles: ev.files }));
      return s;
    case "undo_confirm": // asked after its answer ended: the card stands alone, not as that request's answer
      ensureAnswer(s, null).parts.push({ kind: "undo", ev, done: null });
      s.toolsOpen = false;
      return s;
    case "undo_done":
      updatePart(s, (p) => p.kind === "undo" && p.ev.id === ev.id && !p.done, (p) => ({ ...p, done: ev }) as Part);
      if (ev.ok) updateAnswer(s, ev.user_id, (a) => ({ ...a, undone: true }));
      return s;
    case "task": {
      const { type: _t, folder: _f, session: _s, replay: _r, ...task } = ev;
      if (updatePart(s, (p) => p.kind === "task" && p.task.task_id === ev.task_id, () => ({ kind: "task", task }))) return s;
      if (s.replaying) return state; // finished long ago: the transcript tells the story
      place(ensureAnswer(s), { kind: "task", task }, ev.tool_use_id, true);
      return s;
    }
    case "result":
      finish(s);
      if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
        s.items.push({ kind: "end", key: s.seq++, text: ev.subtype === "error_during_execution" ? "Stopped." : `Ended: ${ev.subtype}` });
      }
      return s;
    case "timing":
      updateAnswer(s, ev.turn, (a) => ({ ...a, timing: timingLine(ev.model, ev.hops as Record<string, unknown>) }));
      return s;
    case "notice":
      s.items.push({ kind: "notice", key: s.seq++, text: ev.text, level: ev.level ?? null });
      return s;
    case "error":
      s.items.push({ kind: "notice", key: s.seq++, text: ev.text, level: "error" });
      return s;
    default:
      return state;
  }
}

// -- answer helpers (exported for tests) ----------------------------------------------------------

/** One answer as text: each block's spoken line, then its written text. */
export function answerText(a: Answer): string {
  return a.parts.filter((p) => p.kind === "text").map((p) => [p.said.trim(), p.text.trim()].filter(Boolean).join("\n\n")).join("\n\n");
}

/** Tool steps in a few words: "Read app.ts, edited server.py and 2 more". */
export function toolsLabel(rows: ToolRow[]): string {
  const ps = [...new Set(rows.map((r) => phrase(r.name, r.input)))];
  let t = ps.slice(0, 2).join(", ");
  if (ps.length > 2) t += ` and ${ps.length - 2} more`;
  return t ? t[0].toUpperCase() + t.slice(1) : "Working";
}

const base = (p: unknown) => String(p ?? "").split("/").filter(Boolean).pop() || String(p ?? "");
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function phrase(name: string, inp: Record<string, unknown> = {}): string {
  const str = (k: string) => (typeof inp[k] === "string" ? (inp[k] as string) : "");
  if (name === "Bash") return str("description") ? lower(str("description")) : "ran a command";
  if (name === "Read") return `read ${base(inp.file_path)}`;
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(name)) return `edited ${base(inp.file_path ?? inp.notebook_path)}`;
  if (name === "Grep") return `searched for “${str("pattern").slice(0, 28)}”`;
  if (name === "Glob") return "listed files";
  if (name === "WebFetch") { try { return `fetched ${new URL(str("url")).hostname}`; } catch { return "fetched a page"; } }
  if (name === "WebSearch") return "searched the web";
  if (name === "Task" || name === "Agent") return str("description") ? lower(str("description")) : "ran an agent";
  if (name === "TodoWrite") return "updated the plan";
  if (name === "Skill") return `used the ${str("skill") || str("command")} skill`;
  if (name.startsWith("mcp__")) return `used ${name.split("__").pop()!.replace(/[_-]/g, " ")}`;
  return name ? lower(name) : "a tool";
}

export function taskText(t: TaskInfo): string {
  const who = t.coder ? "Opus" : "Background task";
  const what = t.description ? `: ${t.description}` : "";
  return t.status === "running" ? `${who} working${what}` : `${who} ${t.status === "completed" ? "done" : t.status}${what}`;
}

/** What the card says once answered. */
export function verdict(p: Extract<Part, { kind: "perm" }>): string {
  const d = p.done!;
  const how = d.heard ? ` by voice: “${d.heard}”` : "";
  const answers = d.answers && typeof d.answers === "object" ? Object.values(d.answers as Record<string, unknown>).flat().join(", ") : "";
  if (answers) return `Answered: ${answers}${how}`;
  if (d.allow) return `Allowed${how}`;
  return (p.ev.tool === "AskUserQuestion" && d.answers === null ? "Skipped" : "Denied") + how;
}

// -- store ---------------------------------------------------------------------------------------

export const useChat = create<ChatState>(initialChat);

const CHAT_EVENTS = [
  "opened", "history", "user", "text_start", "text", "said", "held", "tool_start", "tool_input", "tool_result",
  "permission", "permission_done", "undo_available", "undo_confirm", "undo_done", "task", "result", "timing", "notice", "error",
] as const;

export function wireChat(): () => void {
  const apply = (ev: ServerEvent) => {
    // Another session's stream (this connection may hear several): not this conversation.
    const cur = useSession.getState().session;
    if (ev.type !== "opened" && "session" in ev && ev.session && cur && ev.session !== cur) return;
    useChat.setState((s) => reduce(s, ev));
  };
  const offs = CHAT_EVENTS.map((t) => on(t, apply as never));
  return () => offs.forEach((off) => off());
}
