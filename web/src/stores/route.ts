// The address bar follows the page: / is Home, /s/<session> a conversation, /t/<note>/<line>
// a task from the notes, /r/<routine> a routine's result, /n/<note> a note in Brain, and /brain, /sessions, /routines, /tasks, /settings, /vikunjas the views. Back / Forward
// and links work, and a reload comes back to the same place. The old /chats and /activity land on Sessions (/activity
// showing only what runs or waits) and the address becomes /sessions.
import type { FolderItem, NavigateEvent } from "../protocol.gen";
import { useFeatures } from "./features";
import { openFolder, useSession } from "./session";
import { openSessions, useViews, type View } from "./views";
import { openTask, sameTask, useTasks, type TaskRef } from "./tasks";
import { openRoutine, useRoutineScreen } from "./routine";
import { openItem, openItems, SOURCES, useItems, type ItemSource } from "./items";
import { openBrain, openNote, useBrain } from "./brain";
import { on } from "../events";

const BASE = "";
const VIEWS: View[] = ["sessions", "routines", "tasks", "settings", "brain"];

export interface Route { view: View; session: string | null; task?: TaskRef | null; routine?: string | null; items?: { source: ItemSource; id?: string }; note?: string | null; running?: boolean }

export function parseRoute(pathname: string): Route {
  const rest = pathname.replace(/^\/+|\/+$/g, "");
  const m = rest.match(/^s\/([^/]+)$/);
  if (m) return { view: "chat", session: decodeURIComponent(m[1]) };
  const t = rest.match(/^t\/([^/]+)\/(\d+)$/);
  if (t) return { view: "task", session: null, task: { file: decodeURIComponent(t[1]), line: Number(t[2]) } };
  const n = rest.match(/^n\/(.+)$/);
  if (n) return { view: "note", session: null, note: decodeURIComponent(n[1]) };
  const r = rest.match(/^r\/([^/]+)$/);
  if (r) return { view: "routine", session: null, routine: decodeURIComponent(r[1]) };
  const it = rest.match(/^items\/([a-z]+)(?:\/(.+))?$/);
  if (it && (SOURCES as string[]).includes(it[1])) {
    const items = { source: it[1] as ItemSource, id: it[2] ? decodeURIComponent(it[2]) : undefined };
    return { view: items.id ? "item" : "items", session: null, items };
  }
  if (rest === "vikunjas") return { view: "items", session: null, items: { source: "vikunja" } };
  if (rest === "chat") return { view: "chat", session: null };
  if (rest === "chats") return { view: "sessions", session: null };
  if (rest === "activity") return { view: "sessions", session: null, running: true };
  return { view: (VIEWS as string[]).includes(rest) ? (rest as View) : "home", session: null };
}

export function routePath(r: Route): string {
  if (r.view === "home") return "/";
  if (r.view === "chat") return r.session ? `${BASE}/s/${encodeURIComponent(r.session)}` : `${BASE}/chat`;
  if (r.view === "routine") return r.routine ? `${BASE}/r/${encodeURIComponent(r.routine)}` : `${BASE}/routines`;
  if (r.view === "items" || r.view === "item") {
    const i = r.items;
    return i ? `${BASE}/items/${i.source}${r.view === "item" && i.id ? `/${encodeURIComponent(i.id)}` : ""}` : "/";
  }
  if (r.view === "note") return r.note ? `${BASE}/n/${encodeURIComponent(r.note)}` : `${BASE}/brain`;
  if (r.view === "task") return r.task ? `${BASE}/t/${encodeURIComponent(r.task.file)}/${r.task.line}` : "/";
  return `${BASE}/${r.view}`;
}

/** The folder that holds a session, from the folder list. */
export function folderOf(folders: FolderItem[], key: string): FolderItem | undefined {
  return folders.find((f) => (f.sessions ?? []).some((s) => s.key === key));
}

/** Show what a route names: a view, or open its session (once the folder list knows it). */
export function applyRoute(r: Route): boolean {
  if (r.view === "routine") {
    if (!r.routine) return false;
    openRoutine(r.routine);
    return true;
  }
  if (r.view === "task") {
    if (!r.task) return false;
    if (!sameTask(r.task, useTasks.getState().task) || useViews.getState().view !== "task") openTask(r.task);
    return true;
  }
  if (r.view === "chat" && r.session && r.session !== useSession.getState().session) {
    const f = folderOf(useFeatures.getState().folders, r.session);
    if (!f) return false;
    openFolder(f.path, r.session);
    return true;
  }
  if (r.view === "items" || r.view === "item") {
    if (!r.items) return false;
    if (r.view === "item" && r.items.id) openItem(r.items.source, r.items.id); else openItems(r.items.source);
    return true;
  }
  if (r.view === "note") {
    if (!r.note) return false;
    openNote(r.note);
    return true;
  }
  if (r.view === "brain") {
    openBrain();
    return true;
  }
  if (r.view === "sessions") {
    if (location.pathname !== "/sessions") history.replaceState(null, "", "/sessions" + location.search); // an old address
    openSessions(!!r.running);
    return true;
  }
  useViews.setState({ view: r.view });
  return true;
}

/** open_screen ("pokaż sesje", "open the last run of inspire"): the server already checked where to go, so the page
 * goes there as if the owner had tapped it. Brain lands on its list, or on the note it names. */
export function followNavigate(ev: NavigateEvent) {
  if (ev.destination === "sessions") {
    if (ev.folder && ev.session) openFolder(ev.folder, ev.session); else openSessions(ev.running);
  } else if (ev.destination === "brain") {
    if (ev.note) openNote(ev.note); else openBrain();
  } else if (ev.destination === "tasks") {
    if (ev.task) openItem("vikunja", ev.task); else useViews.setState({ view: "tasks" });
  } else if (ev.destination === "routines" && ev.routine) {
    openRoutine(ev.routine);
  } else {
    useViews.setState({ view: ev.destination });
  }
}

/** The route the page asked for when it loaded; hello uses it instead of the quiet reopen. */
export const startRoute = (): Route => parseRoute(location.pathname);

function itemsRoute(): Route["items"] {
  const { source, id } = useItems.getState();
  return source ? { source, id: id ?? undefined } : undefined;
}

function applyItems(r: Route) {
  if (r.items && r.view === "items") openItems(r.items.source);
  if (r.items?.id && r.view === "item") openItem(r.items.source, r.items.id);
}

export function wireRoute(): () => void {
  const current = (): Route => ({ view: useViews.getState().view, session: useSession.getState().session, task: useTasks.getState().task, routine: useRoutineScreen.getState().id, items: itemsRoute(), note: useBrain.getState().file });
  const sync = () => {
    const path = routePath(current());
    if (path !== location.pathname) history.pushState(null, "", path + location.search);
  };
  const offViews = useViews.subscribe((s, prev) => { if (s.view !== prev.view) sync(); });
  const offSession = useSession.subscribe((s, prev) => { if (s.session !== prev.session && useViews.getState().view === "chat") sync(); });
  const offTask = useTasks.subscribe((s, prev) => { if (s.task !== prev.task && useViews.getState().view === "task") sync(); });
  const offItems = useItems.subscribe((s, prev) => { if ((s.source !== prev.source || s.id !== prev.id) && ["items", "item"].includes(useViews.getState().view)) sync(); });
  const offNote = useBrain.subscribe((s, prev) => { if (s.file !== prev.file && useViews.getState().view === "note") sync(); });
  const offRoutine = useRoutineScreen.subscribe((s, prev) => { if (s.id !== prev.id && useViews.getState().view === "routine") sync(); });
  let start: Route | null = parseRoute(location.pathname); // the address the page was opened with
  const offHello = on("hello", () => { // a link to a task: open it once the server is there
    if (start?.view === "task" && start.task) openTask(start.task);
    if (start?.view === "routine" && start.routine) openRoutine(start.routine);
    if (start?.view === "note" && start.note) openNote(start.note);
    if (start?.view === "brain") openBrain();
    if (start) applyItems(start);
    start = null;
  });
  const offNavigate = on("navigate", followNavigate);
  const onPop = () => {
    const r = parseRoute(location.pathname);
    if (!applyRoute(r)) history.replaceState(null, "", routePath(current())); // a session that's gone
  };
  addEventListener("popstate", onPop);
  return () => { offViews(); offSession(); offTask(); offRoutine(); offNote(); offItems(); offHello(); offNavigate(); removeEventListener("popstate", onPop); };
}
