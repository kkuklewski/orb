// The address bar follows the page: / is Home, /s/<session> a conversation, /t/<note>/<line>
// a task from the notes, /r/<routine> a routine's result, and /activity, /routines, /settings, /vikunjas the views. Back / Forward
// and links work, and a reload comes back to the same place.
import type { FolderItem } from "../protocol.gen";
import { useFeatures } from "./features";
import { openFolder, useSession } from "./session";
import { useViews, type View } from "./views";
import { openTask, sameTask, useTasks, type TaskRef } from "./tasks";
import { openRoutine, useRoutineScreen } from "./routine";
import { openVikunjaList } from "./vikunja";
import { on } from "../events";

const BASE = "";
const VIEWS: View[] = ["activity", "routines", "settings", "vikunjas"];

export interface Route { view: View; session: string | null; task?: TaskRef | null; routine?: string | null }

export function parseRoute(pathname: string): Route {
  const rest = pathname.replace(/^\/+|\/+$/g, "");
  const m = rest.match(/^s\/([^/]+)$/);
  if (m) return { view: "chat", session: decodeURIComponent(m[1]) };
  const t = rest.match(/^t\/([^/]+)\/(\d+)$/);
  if (t) return { view: "task", session: null, task: { file: decodeURIComponent(t[1]), line: Number(t[2]) } };
  const r = rest.match(/^r\/([^/]+)$/);
  if (r) return { view: "routine", session: null, routine: decodeURIComponent(r[1]) };
  if (rest === "chat") return { view: "chat", session: null };
  return { view: (VIEWS as string[]).includes(rest) ? (rest as View) : "home", session: null };
}

export function routePath(r: Route): string {
  if (r.view === "home") return "/";
  if (r.view === "chat") return r.session ? `${BASE}/s/${encodeURIComponent(r.session)}` : `${BASE}/chat`;
  if (r.view === "routine") return r.routine ? `${BASE}/r/${encodeURIComponent(r.routine)}` : `${BASE}/routines`;
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
  useViews.setState({ view: r.view });
  if (r.view === "vikunjas") openVikunjaList();
  return true;
}

/** The route the page asked for when it loaded; hello uses it instead of the quiet reopen. */
export const startRoute = (): Route => parseRoute(location.pathname);

export function wireRoute(): () => void {
  const current = (): Route => ({ view: useViews.getState().view, session: useSession.getState().session, task: useTasks.getState().task, routine: useRoutineScreen.getState().id });
  const sync = () => {
    const path = routePath(current());
    if (path !== location.pathname) history.pushState(null, "", path + location.search);
  };
  const offViews = useViews.subscribe((s, prev) => { if (s.view !== prev.view) sync(); });
  const offSession = useSession.subscribe((s, prev) => { if (s.session !== prev.session && useViews.getState().view === "chat") sync(); });
  const offTask = useTasks.subscribe((s, prev) => { if (s.task !== prev.task && useViews.getState().view === "task") sync(); });
  const offRoutine = useRoutineScreen.subscribe((s, prev) => { if (s.id !== prev.id && useViews.getState().view === "routine") sync(); });
  let start: Route | null = parseRoute(location.pathname); // the address the page was opened with
  const offHello = on("hello", () => { // a link to a task: open it once the server is there
    if (start?.view === "task" && start.task) openTask(start.task);
    if (start?.view === "routine" && start.routine) openRoutine(start.routine);
    if (start?.view === "vikunjas") openVikunjaList();
    start = null;
  });
  const onPop = () => {
    const r = parseRoute(location.pathname);
    if (!applyRoute(r)) history.replaceState(null, "", routePath(current())); // a session that's gone
  };
  addEventListener("popstate", onPop);
  return () => { offViews(); offSession(); offTask(); offRoutine(); offHello(); removeEventListener("popstate", onPop); };
}
