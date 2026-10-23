// The address bar follows the page: /next is Home, /next/s/<session> a conversation, and
// /next/activity, /next/routines, /next/settings the views. Back / Forward and links work, and a
// reload comes back to the same place.
import type { FolderItem } from "../protocol.gen";
import { useFeatures } from "./features";
import { openFolder, useSession } from "./session";
import { useViews, type View } from "./views";

const BASE = "/next";
const VIEWS: View[] = ["activity", "routines", "settings"];

export interface Route { view: View; session: string | null }

export function parseRoute(pathname: string): Route {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length).replace(/^\/+|\/+$/g, "") : "";
  const m = rest.match(/^s\/([^/]+)$/);
  if (m) return { view: "chat", session: decodeURIComponent(m[1]) };
  if (rest === "chat") return { view: "chat", session: null };
  return { view: (VIEWS as string[]).includes(rest) ? (rest as View) : "home", session: null };
}

export function routePath(r: Route): string {
  if (r.view === "home") return BASE;
  if (r.view === "chat") return r.session ? `${BASE}/s/${encodeURIComponent(r.session)}` : `${BASE}/chat`;
  return `${BASE}/${r.view}`;
}

/** The folder that holds a session, from the folder list. */
export function folderOf(folders: FolderItem[], key: string): FolderItem | undefined {
  return folders.find((f) => (f.sessions ?? []).some((s) => s.key === key));
}

/** Show what a route names: a view, or open its session (once the folder list knows it). */
export function applyRoute(r: Route): boolean {
  if (r.view === "chat" && r.session && r.session !== useSession.getState().session) {
    const f = folderOf(useFeatures.getState().folders, r.session);
    if (!f) return false;
    openFolder(f.path, r.session);
    return true;
  }
  useViews.setState({ view: r.view });
  return true;
}

/** The route the page asked for when it loaded; hello uses it instead of the quiet reopen. */
export const startRoute = (): Route => parseRoute(location.pathname);

export function wireRoute(): () => void {
  const current = (): Route => ({ view: useViews.getState().view, session: useSession.getState().session });
  const sync = () => {
    const path = routePath(current());
    if (path !== location.pathname) history.pushState(null, "", path + location.search);
  };
  const offViews = useViews.subscribe((s, prev) => { if (s.view !== prev.view) sync(); });
  const offSession = useSession.subscribe((s, prev) => { if (s.session !== prev.session && useViews.getState().view === "chat") sync(); });
  const onPop = () => {
    const r = parseRoute(location.pathname);
    if (!applyRoute(r)) history.replaceState(null, "", routePath(current())); // a session that's gone
  };
  addEventListener("popstate", onPop);
  return () => { offViews(); offSession(); removeEventListener("popstate", onPop); };
}
