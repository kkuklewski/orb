// The open folder and session, the sidebar (pinned repos, recents, search), the repo picker and the
// slash menu's commands. Pure helpers are exported for tests; actions send to the server.
import { create } from "zustand";
import type { CommandItem, FolderItem, ServerEvent, SessionItem } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useFeatures } from "./features";
import { useViews } from "./views";
import { markSent } from "../voice/clock";
import { applyRoute, parseRoute } from "./route";

export type PickerMode = "new" | "pin";

export interface SessionState {
  folder: string | null;
  session: string | null;
  label: string;
  rel: string;
  branch: string | null;
  busy: boolean;
  commands: CommandItem[];
  picker: PickerMode | null;
  expanded: string[];
  drawer: boolean; // narrow screens: the sidebar slides over
  quiet: boolean; // the next "opened" is the start-up reopen: keep showing Home
  pendingAsk: string | null; // sent once the session it was asked in has opened
  pendingScreen: { name: string; text: string } | null; // and what to show Claude with it (untrusted text, fenced by the server)
  pendingStay: boolean; // the answer shows on the screen that asked (a routine's result), so don't switch to the chat
}

const local = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function savedExpanded(): string[] {
  try { const v = JSON.parse(local.get("vd-expanded", "[]")); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

export const initialSession = (): SessionState => ({
  folder: null, session: null, label: "", rel: "", branch: null, busy: false, commands: [],
  picker: null, expanded: savedExpanded(), drawer: false, quiet: false, pendingAsk: null, pendingScreen: null, pendingStay: false,
});

/** Pure: the next state for one event. Session-scoped events for another session are ignored. */
export function reduce(state: SessionState, ev: ServerEvent): SessionState {
  const other = "session" in ev && ev.session && state.session && ev.session !== state.session;
  switch (ev.type) {
    case "opened":
      return { ...state, folder: ev.folder ?? null, session: ev.session ?? null, label: ev.label, rel: ev.rel, branch: ev.branch, busy: ev.busy };
    case "commands":
      return other ? state : { ...state, commands: ev.items };
    case "state":
      return other ? state : { ...state, busy: !!ev.busy };
    default:
      return state;
  }
}

export const useSession = create<SessionState>(initialSession);

export function wireSession(): () => void {
  const apply = (ev: ServerEvent) => useSession.setState((s) => reduce(s, ev));
  const offs = [
    on("opened", (ev) => {
      const { quiet, pendingAsk, pendingScreen, pendingStay } = useSession.getState();
      apply(ev);
      useSession.setState({ quiet: false, pendingAsk: null, pendingScreen: null, pendingStay: false });
      if (ev.folder) local.set("vd-folder", ev.folder);
      if (ev.session) local.set("vd-session", ev.session);
      if (!quiet && ev.folder) setExpanded(ev.folder, true); // an opened chat shows its repo's sessions in the sidebar
      if (!quiet && !pendingStay) useViews.setState({ view: "chat" });
      if (pendingAsk) {
        if (pendingScreen) send({ type: "screen", name: pendingScreen.name, text: pendingScreen.text }); // the request carries it
        markSent();
        send({ type: "user_text", text: pendingAsk, interrupt: false });
      }
    }),
    on("commands", apply),
    on("state", apply),
    on("user", (ev) => { // a request in the open session (spoken from Home, say): show the conversation
      const cur = useSession.getState().session;
      if (!ev.replay && (!ev.session || ev.session === cur) && useViews.getState().view === "home") useViews.setState({ view: "chat" });
    }),
    on("hello", (ev) => {
      if (!ev.onboarded) return;
      // The address names a session (a link, a reload): open it. Else reopen where you were,
      // quietly, so voice and chat are ready, but start on Home (or the view the address names).
      const asked = parseRoute(location.pathname);
      const target = asked.session ? ev.folders.find((f) => (f.sessions ?? []).some((x) => x.key === asked.session)) : undefined;
      if (target) { openFolder(target.path, asked.session!); return; }
      if (asked.view === "sessions") applyRoute(asked);
      else useViews.setState({ view: ["chat", "task", "routine"].includes(asked.view) ? "home" : asked.view }); // those open once wired (route.ts)
      const last = local.get("vd-folder", "");
      if (last && ev.folders.some((f) => f.path === last)) {
        useSession.setState({ quiet: true });
        openFolder(last, local.get("vd-session", "") || undefined);
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}

// -- actions -------------------------------------------------------------------------------------

export function openFolder(path: string, session?: string) {
  send({ type: "open_folder", path, session });
  useSession.setState({ drawer: false });
}

export function startSession(path: string) {
  send({ type: "start_session", path });
  useSession.setState({ drawer: false });
}

const LABEL_MAX = 60; // the server labels a session with its first request, cut here (sessions.py)
const sameDay = (a: number, b: number) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();

/** The session in `path` opened today by this same request that is idle now (so asking again doesn't pile up copies). */
export function reusableSession(folders: FolderItem[], path: string, text: string, now = Date.now() / 1000): SessionItem | undefined {
  const t = text.trim();
  const label = t.slice(0, LABEL_MAX) + (t.length > LABEL_MAX ? "…" : "");
  const f = folders.find((x) => x.path === path);
  return (f?.sessions ?? []).find((x) => !x.archived && !x.empty && x.status === "idle" && x.label === label && x.created != null && sameDay(x.created, now));
}

/** A session in `path` that starts with `text` (Home's "Ask your notes"): today's idle one with the same request when
 *  there is one, a fresh one otherwise. */
export function askIn(path: string, text: string, screen: { name: string; text: string } | null = null, stay = false) {
  useSession.setState({ pendingAsk: text, pendingScreen: screen, pendingStay: stay });
  const again = reusableSession(useFeatures.getState().folders, path, text);
  if (again) openFolder(path, again.key); else startSession(path);
}

/** The start page's Project menu: a fresh session in `path`, reusing its unused one so switching back and forth doesn't
 *  pile up empty sessions. */
export function startIn(path: string) {
  if (path === useSession.getState().folder) return;
  const f = useFeatures.getState().folders.find((x) => x.path === path);
  const unused = (f?.sessions ?? []).find((s) => s.empty && !s.archived);
  if (unused) openFolder(path, unused.key); else startSession(path);
}

export function newSession() {
  send({ type: "new_session" });
}

export function pinFolder(path: string, pinned: boolean) {
  send({ type: "pin_folder", path, pinned });
  if (pinned) setExpanded(path, true);
}

export function setExpanded(path: string, open: boolean) {
  const cur = useSession.getState().expanded.filter((p) => p !== path);
  const expanded = open ? [...cur, path] : cur;
  useSession.setState({ expanded });
  local.set("vd-expanded", JSON.stringify(expanded));
}

/** A pinned repo's row: opens it (its latest session) and unfolds it; clicking the open one folds it. */
export function toggleProject(path: string) {
  const { folder, expanded } = useSession.getState();
  if (path === folder && expanded.includes(path)) { setExpanded(path, false); return; }
  setExpanded(path, true);
  if (path !== folder) openFolder(path);
}

export function openPicker(mode: PickerMode) { useSession.setState({ picker: mode, drawer: false }); }
export function closePicker() { useSession.setState({ picker: null, pendingAsk: null, pendingScreen: null, pendingStay: false }); } // a question waiting for a repo goes too

/** Picker choice (a listed repo or a pasted path): start a session there, or pin it. */
export function choosePath(path: string) {
  const mode = useSession.getState().picker;
  useSession.setState({ picker: null, drawer: false });
  if (mode === "pin") pinFolder(path, true);
  else startSession(path);
}

/** Typed request. Without an open folder the picker asks where first. */
export function sendText(text: string): boolean {
  const t = text.trim();
  const { folder, busy } = useSession.getState();
  if (!t) return false;
  if (!folder) { openPicker("new"); return false; }
  markSent();
  send({ type: "user_text", text: t, interrupt: busy });
  return true;
}

export const currentFolder = (): FolderItem | undefined => {
  const { folder } = useSession.getState();
  return useFeatures.getState().folders.find((f) => f.path === folder);
};

// -- pure helpers --------------------------------------------------------------------------------

export type Row = SessionItem & { folder: FolderItem };

export const folderName = (f: { label: string }) => f.label.split("/").pop() || f.label;

/** Every session, last request first (opening one doesn't reorder); never-used ones only when on screen. */
export function allSessions(folders: FolderItem[], current: string | null): Row[] {
  const out: Row[] = [];
  for (const f of folders) for (const s of f.sessions ?? []) if (!s.archived && (!s.empty || s.key === current)) out.push({ ...s, folder: f });
  return out.sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0));
}

/** Archived sessions across repos, last request first. */
export function archivedSessions(folders: FolderItem[]): Row[] {
  const out: Row[] = [];
  for (const f of folders) for (const s of f.sessions ?? []) if (s.archived) out.push({ ...s, folder: f });
  return out.sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0));
}

export function archiveSession(folder: string, key: string, archived = true) {
  send({ type: "archive_session", folder, key, archived });
}

export function removeSession(folder: string, key: string) {
  send({ type: "remove_session", folder, key });
}

export function pinnedFolders(folders: FolderItem[]): FolderItem[] {
  return folders.filter((f) => f.pinned).sort((a, b) => folderName(a).localeCompare(folderName(b)));
}

export function folderSessions(f: FolderItem, current: string | null, limit = 8): Row[] {
  return (f.sessions ?? []).filter((s) => !s.archived && (!s.empty || s.key === current)).slice(0, limit).map((s) => ({ ...s, folder: f }));
}

/** Sidebar search: session titles and folder names, then folders by name or path. */
export function search(folders: FolderItem[], q: string, current: string | null): { sessions: Row[]; folders: FolderItem[] } {
  const n = q.trim().toLowerCase();
  if (!n) return { sessions: [], folders: [] };
  return {
    sessions: allSessions(folders, current).filter((x) => (x.label ?? "").toLowerCase().includes(n) || x.folder.label.toLowerCase().includes(n)).slice(0, 8),
    folders: folders.filter((f) => f.label.toLowerCase().includes(n) || f.rel.toLowerCase().includes(n)).slice(0, 8),
  };
}

/** Picker: every repo, recently used first, then by name. */
export function pickerItems(folders: FolderItem[], q: string): FolderItem[] {
  const n = q.trim().toLowerCase();
  return folders.filter((f) => !n || f.label.toLowerCase().includes(n) || f.rel.toLowerCase().includes(n))
    .sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0) || a.label.localeCompare(b.label));
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from", "fix", "add", "run",
  "test", "tests", "check", "review", "write", "move", "update", "create", "make", "use", "set", "all", "one", "new", "my", "notes", "note", "task", "todo"]);

/** Words worth matching a repo by: lower-case, 3+ letters, not filler. */
export function keywords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** Repos a task likely belongs to: the ones whose name or path shares a word with the task, its heading
 *  or its note's title; recent use breaks ties. The notes folder itself is never suggested. */
export function suggestRepos(folders: FolderItem[], text: string, vault: string, limit = 3): FolderItem[] {
  const words = keywords(text);
  const scored = folders.filter((f) => f.path !== vault).map((f) => {
    const hay = `${f.label} ${f.rel} ${f.path.split("/").pop() ?? ""}`.toLowerCase();
    const parts = hay.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    for (const w of words) {
      if (parts.includes(w)) score += 3; // "n8n" is a path segment or the repo name
      else if (hay.includes(w) || parts.some((p) => p.length >= 4 && w.includes(p))) score += 1; // part of a longer name, like "n8n-skills"
    }
    return { f, score };
  }).filter((x) => x.score > 0);
  return scored.sort((a, b) => b.score - a.score || (b.f.last_used ?? 0) - (a.f.last_used ?? 0)).slice(0, limit).map((x) => x.f);
}

export function rel(ts?: number | null, now = Date.now() / 1000): string {
  if (!ts) return "";
  const s = now - ts;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// -- slash menu ----------------------------------------------------------------------------------

/** "/na" typed alone at the start of the composer → "na"; anything else → null (menu closed). */
export function slashQuery(text: string): string | null {
  const m = text.match(/^\/(\S*)$/);
  return m ? m[1].toLowerCase() : null;
}

function rank(c: CommandItem, q: string): number {
  if (!q) return 0;
  const n = c.name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(":").pop()!.startsWith(q)) return 1; // plugin skills: "/acc" finds "design:accessibility-review"
  if (n.includes(q)) return 2;
  return (c.description ?? "").toLowerCase().includes(q) ? 3 : -1;
}

/** Commands matching the query: name prefix, then plugin-skill prefix, then anywhere, then description. */
export function slashMatches(items: CommandItem[], q: string, limit = 80): CommandItem[] {
  return items.map((c, i) => [rank(c, q), i, c] as const).filter((x) => x[0] >= 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}
