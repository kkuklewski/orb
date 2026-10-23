// The open folder and session, the sidebar (pinned repos, recents, search), the repo picker and the
// slash menu's commands. Pure helpers are exported for tests; actions send to the server.
import { create } from "zustand";
import type { CommandItem, FolderItem, ServerEvent, SessionItem } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useFeatures } from "./features";
import { useViews } from "./views";
import { markSent } from "../voice/clock";

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
  picker: null, expanded: savedExpanded(), drawer: false,
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
      apply(ev);
      if (ev.folder) local.set("vd-folder", ev.folder);
      if (ev.session) local.set("vd-session", ev.session);
      useViews.setState({ view: "chat" });
    }),
    on("commands", apply),
    on("state", apply),
    on("hello", (ev) => { // back where you were, like the full page; else the picker
      if (!ev.onboarded) return;
      const last = local.get("vd-folder", "");
      if (last && ev.folders.some((f) => f.path === last)) openFolder(last, local.get("vd-session", "") || undefined);
      else if (!useSession.getState().folder) openPicker("new");
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
export function closePicker() { useSession.setState({ picker: null }); }

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

/** Every session, newest first; never-used ones only when on screen. */
export function allSessions(folders: FolderItem[], current: string | null): Row[] {
  const out: Row[] = [];
  for (const f of folders) for (const s of f.sessions ?? []) if (!s.empty || s.key === current) out.push({ ...s, folder: f });
  return out.sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0));
}

export function pinnedFolders(folders: FolderItem[]): FolderItem[] {
  return folders.filter((f) => f.pinned).sort((a, b) => folderName(a).localeCompare(folderName(b)));
}

export function folderSessions(f: FolderItem, current: string | null, limit = 8): Row[] {
  return (f.sessions ?? []).filter((s) => !s.empty || s.key === current).slice(0, limit).map((s) => ({ ...s, folder: f }));
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
